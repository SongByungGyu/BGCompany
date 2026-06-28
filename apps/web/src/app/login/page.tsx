"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function resolveNextPath() {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((response) => response.ok ? response.json() : { authenticated: false })
      .then((session: { authenticated?: boolean }) => {
        if (!cancelled && session.authenticated) router.replace(resolveNextPath());
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        body: JSON.stringify({ password }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string } | null;
        setError(body?.message ?? "로그인에 실패했습니다.");
        return;
      }
      router.replace(resolveNextPath());
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="login-brand"><b>✦</b><span>BG Company</span></div>
        <p className="login-eyebrow">Admin Access</p>
        <h1>BG Company Admin</h1>
        <p className="login-copy">관리자 비밀번호를 입력하세요.</p>
        <form onSubmit={submit}>
          <label>
            관리자 비밀번호
            <input
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button disabled={isSubmitting || !password.trim()} type="submit">
            {isSubmitting ? "확인 중..." : "로그인"}
          </button>
        </form>
      </section>
    </main>
  );
}
