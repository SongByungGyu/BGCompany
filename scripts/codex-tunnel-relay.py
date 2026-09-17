#!/usr/bin/env python3
"""Relay Docker-network traffic to the loopback-only Codex reverse SSH tunnel."""

import asyncio
import os


LISTEN_HOST = os.environ.get("CODEX_RELAY_LISTEN_HOST", "172.16.1.1")
LISTEN_PORT = int(os.environ.get("CODEX_RELAY_LISTEN_PORT", "43927"))
TARGET_HOST = os.environ.get("CODEX_RELAY_TARGET_HOST", "127.0.0.1")
TARGET_PORT = int(os.environ.get("CODEX_RELAY_TARGET_PORT", "43926"))


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while chunk := await reader.read(64 * 1024):
            writer.write(chunk)
            await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


async def handle(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    try:
        target_reader, target_writer = await asyncio.open_connection(TARGET_HOST, TARGET_PORT)
    except OSError:
        client_writer.close()
        await client_writer.wait_closed()
        return
    await asyncio.gather(
        pipe(client_reader, target_writer),
        pipe(target_reader, client_writer),
        return_exceptions=True,
    )


async def main() -> None:
    server = await asyncio.start_server(handle, LISTEN_HOST, LISTEN_PORT)
    print(f"codex relay listening on {LISTEN_HOST}:{LISTEN_PORT} -> {TARGET_HOST}:{TARGET_PORT}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
