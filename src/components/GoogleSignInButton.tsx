"use client";

import { useEffect, useRef } from "react";

type GoogleId = {
  initialize: (cfg: {
    client_id: string;
    callback: (resp: { credential: string }) => void;
  }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

// Renders the official "Sign in with Google" button via Google Identity Services.
// Returns the signed id_token to `onCredential`. Renders nothing if the public
// client id is not configured, so the app works without Google set up.
export default function GoogleSignInButton({
  onCredential,
}: {
  onCredential: (credential: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onCredential);
  useEffect(() => {
    cbRef.current = onCredential;
  }, [onCredential]);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !ref.current) return;

    function render() {
      const g = window.google?.accounts.id;
      if (!g || !ref.current) return;
      g.initialize({
        client_id: clientId!,
        callback: (resp) => cbRef.current(resp.credential),
      });
      g.renderButton(ref.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
        logo_alignment: "center",
      });
    }

    if (window.google?.accounts?.id) {
      render();
      return;
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", render);
    return () => script?.removeEventListener("load", render);
  }, [clientId]);

  if (!clientId) return null;
  return <div ref={ref} className="flex justify-center" />;
}
