/**
 * App-wide crash net. Before this existed, ANY uncaught render/effect error
 * anywhere in the tree (e.g. the SheetGrid selectionEnd crash on number/date
 * cells — see grid/SheetGrid.tsx) unmounted the whole React tree and left a
 * blank white screen with zero explanation, and any unsaved work in that
 * screen was gone with no way back short of a reload. This does not recover
 * that unsaved data (React state is gone once an error escapes render — that
 * part is unavoidable), but it stops the *screen itself* from going blank so
 * the user sees what broke and can go back, instead of a dead white page.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] caught a render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    // NOTE: this project has no @types/react installed, so every React
    // import (including `Component`) resolves to `any` and plain function
    // components go unchecked. That's invisible everywhere else, but
    // extending `Component<Props, State>` as a class hits a real TS quirk:
    // when the base class type is `any`, inherited members (props,
    // setState, context, ...) that aren't redeclared here fail "does not
    // exist on type" even though they exist fine at runtime. Casting `this`
    // to `any` at just these two access points sidesteps it without
    // installing @types/react mid-fix (a separate, bigger change with its
    // own blast radius across ~2800 modules that never needed it before).
    if (!error) return (this as any).props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F8FAFC",
          padding: 24,
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
        }}
      >
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>
            Kuch ghalat ho gaya · Something went wrong
          </h1>
          <p style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>
            Yeh screen crash hui, lekin baaqi app theek hai. Neeche wapis jayein ya reload karein.
            Agar koi row save nahi hui thi, wo dobara likhni pare gi.
          </p>
          <pre
            style={{
              fontSize: 11,
              color: "#B91C1C",
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: 8,
              padding: 10,
              textAlign: "left",
              overflowX: "auto",
              marginBottom: 16,
            }}
          >
            {error.message}
          </pre>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              onClick={() => (this as any).setState({ error: null })}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #16A34A",
                background: "#fff",
                color: "#16A34A",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Wapis jayein · Go back
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "#16A34A",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
