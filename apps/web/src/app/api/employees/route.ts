import { NextResponse } from "next/server";
import { listEmployees } from "@/lib/repositories/employees";

export async function GET() {
  const employees = await listEmployees();
  return NextResponse.json({ employees });
}
