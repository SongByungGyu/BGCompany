if (-not ("BGCompany.ProcessCurrentDirectoryReader" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace BGCompany {
  public static class ProcessCurrentDirectoryReader {
    private const uint ProcessQueryInformation = 0x0400;
    private const uint ProcessVmRead = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessBasicInformation {
      public IntPtr Reserved1;
      public IntPtr PebBaseAddress;
      public IntPtr Reserved2_0;
      public IntPtr Reserved2_1;
      public IntPtr UniqueProcessId;
      public IntPtr Reserved3;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(
      IntPtr process,
      IntPtr baseAddress,
      byte[] buffer,
      int size,
      out IntPtr bytesRead);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
      IntPtr process,
      int informationClass,
      ref ProcessBasicInformation processInformation,
      int processInformationLength,
      out int returnLength);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
      IntPtr process,
      int informationClass,
      out IntPtr processInformation,
      int processInformationLength,
      out int returnLength);

    private static byte[] ReadBytes(IntPtr process, IntPtr address, int length) {
      byte[] bytes = new byte[length];
      IntPtr read;
      if (!ReadProcessMemory(process, address, bytes, length, out read) || read.ToInt64() != length) {
        return null;
      }
      return bytes;
    }

    private static IntPtr ReadPointer(IntPtr process, IntPtr address, bool pointer32) {
      byte[] bytes = ReadBytes(process, address, pointer32 ? 4 : IntPtr.Size);
      if (bytes == null) return IntPtr.Zero;
      return pointer32
        ? new IntPtr(unchecked((long)BitConverter.ToUInt32(bytes, 0)))
        : new IntPtr(BitConverter.ToInt64(bytes, 0));
    }

    private static string ReadUnicodeString(IntPtr process, IntPtr address, bool pointer32) {
      int headerLength = pointer32 ? 8 : 16;
      byte[] header = ReadBytes(process, address, headerLength);
      if (header == null) return null;
      int byteLength = BitConverter.ToUInt16(header, 0);
      if (byteLength <= 0 || byteLength > 32766 || (byteLength % 2) != 0) return null;
      IntPtr buffer = pointer32
        ? new IntPtr(unchecked((long)BitConverter.ToUInt32(header, 4)))
        : new IntPtr(BitConverter.ToInt64(header, 8));
      if (buffer == IntPtr.Zero) return null;
      byte[] value = ReadBytes(process, buffer, byteLength);
      return value == null ? null : Encoding.Unicode.GetString(value);
    }

    public static string TryRead(int processId) {
      IntPtr process = OpenProcess(ProcessQueryInformation | ProcessVmRead, false, processId);
      if (process == IntPtr.Zero) return null;
      try {
        int returned;
        if (Environment.Is64BitOperatingSystem && Environment.Is64BitProcess) {
          IntPtr wow64Peb;
          int wowStatus = NtQueryInformationProcess(
            process,
            26,
            out wow64Peb,
            IntPtr.Size,
            out returned);
          if (wowStatus == 0 && wow64Peb != IntPtr.Zero) {
            IntPtr parameters32 = ReadPointer(process, IntPtr.Add(wow64Peb, 0x10), true);
            if (parameters32 != IntPtr.Zero) {
              return ReadUnicodeString(process, IntPtr.Add(parameters32, 0x24), true);
            }
          }
        }

        ProcessBasicInformation basic = new ProcessBasicInformation();
        int status = NtQueryInformationProcess(
          process,
          0,
          ref basic,
          Marshal.SizeOf(typeof(ProcessBasicInformation)),
          out returned);
        if (status != 0 || basic.PebBaseAddress == IntPtr.Zero) return null;
        int processParametersOffset = IntPtr.Size == 8 ? 0x20 : 0x10;
        int currentDirectoryOffset = IntPtr.Size == 8 ? 0x38 : 0x24;
        IntPtr parameters = ReadPointer(
          process,
          IntPtr.Add(basic.PebBaseAddress, processParametersOffset),
          false);
        return parameters == IntPtr.Zero
          ? null
          : ReadUnicodeString(process, IntPtr.Add(parameters, currentDirectoryOffset), false);
      } catch {
        return null;
      } finally {
        CloseHandle(process);
      }
    }
  }
}
'@
}

function Get-ProcessCurrentDirectory {
  param([Parameter(Mandatory = $true)][int]$ProcessId)
  return [string][BGCompany.ProcessCurrentDirectoryReader]::TryRead($ProcessId)
}
