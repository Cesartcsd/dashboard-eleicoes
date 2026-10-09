import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { UFS, useUf } from "./lib/uf";
import { CandidatePanel } from "./pages/CandidatePanel";
import { Comparativo } from "./pages/Comparativo";
import { Dobrada } from "./pages/Dobrada";
import { Metodologia } from "./pages/Metodologia";
import { Overview } from "./pages/Overview";
import { PainelView, Paineis } from "./pages/Paineis";
import { Acessos } from "./pages/Acessos";
import { Presidente } from "./pages/Presidente";
import { Publicidade } from "./pages/Publicidade";
import { DigitalMG } from "./pages/DigitalMG";
import { Esperanca } from "./pages/Esperanca";
import { useSouAdmin } from "./lib/acessos";
import { registrarVisita } from "./lib/visitas";
import { isDev } from "./lib/source";
import { L, SeletorIdioma, useLang } from "./lib/i18n";
import { supabase } from "./lib/supabase";

const NAV_PT_EN: [string, string, string, boolean?][] = [
  ["/", "Visão geral", "Overview", true], ["/comparativo", "Comparativo", "Compare"], ["/dobrada", "Dobrada", "Joint ticket"],
  ["/presidente", "Presidente", "President"], ["/publicidade", "Publicidade", "Paid ads"], ["/mapa-mobilizacao", "Mapa de Mobilização", "Mobilization Map"], ["/paineis", "Painéis", "Panels"],
  ["/metodologia", "Metodologia", "Methodology"],
];
const NAV_ITENS = () => NAV_PT_EN.map(([to, pt, en, end]) => ({ to, label: L(pt, en), end }));

function SeletorUf() {
  const { uf, setUf } = useUf();
  const navigate = useNavigate();
  if (UFS.length < 2) return null;
  return (
    <div role="radiogroup" aria-label={L("Estado", "State")} className="inline-flex rounded-md border border-line p-0.5">
      {UFS.map((u) => (
        <button key={u.sigla} type="button" role="radio" aria-checked={uf === u.sigla} title={u.nome}
          onClick={() => { if (u.sigla !== uf) { setUf(u.sigla); navigate("/"); } }}
          className={`rounded px-2.5 py-1 text-sm font-bold ${uf === u.sigla ? "bg-accent text-panel" : "hover:bg-accent-soft"}`}>
          {u.sigla}
        </button>
      ))}
    </div>
  );
}

function Shell({ children, onSair }: { children: ReactNode; onSair?: () => void }) {
  const admin = useSouAdmin();
  const { uf } = useUf();
  const { lang } = useLang();
  const nav = admin.data ? [...NAV_ITENS(), { to: "/acessos", label: L("Acessos", "Access"), end: false }] : NAV_ITENS();
  void lang; // re-render ao trocar idioma
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <NavLink to="/" className="display text-lg">{L("Painel Eleitoral", "Election Dashboard")} <span className="text-accent">{uf} 2026</span></NavLink>
            <SeletorUf />
          </div>
          <nav aria-label={L("Principal", "Main")} className="flex flex-wrap gap-1">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-accent-soft font-semibold text-accent" : "hover:bg-accent-soft"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {isDev && <span className="rounded bg-accent-soft px-2 py-0.5 text-xs text-accent">{L("dados locais (dev)", "local data (dev)")}</span>}
            <SeletorIdioma />
            {onSair && <button type="button" className="text-muted hover:text-ink" onClick={onSair}>{L("Sair", "Sign out")}</button>}
          </div>
        </div>
      </header>
      <main key={`${uf}-${lang}`} className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "erro">("idle");
  const [erro, setErro] = useState("");
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setEstado("enviando");
    const { error } = await supabase().auth.signInWithPassword({
      email: email.trim(), password: senha,
    });
    if (error) {
      setErro(L("E-mail ou senha inválidos.", "Invalid email or password."));
      setEstado("erro");
    } else setEstado("idle");
  };
  return (
    <div className="grid min-h-full place-items-center px-4">
      <form onSubmit={enviar} className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-panel p-6">
        <div className="eyebrow">{L("Acesso restrito à equipe", "Team-only access")}</div>
        <h1 className="display text-2xl">{L("Painel Eleitoral 2026", "Election Dashboard 2026")}</h1>
        <label htmlFor="email" className="flex flex-col gap-1 text-sm text-muted">{L("E-mail", "Email")}
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" className="rounded-md border border-line bg-bg px-3 py-2 text-ink" />
        </label>
        <label htmlFor="senha" className="flex flex-col gap-1 text-sm text-muted">{L("Senha", "Password")}
          <input id="senha" type="password" required value={senha} onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password" className="rounded-md border border-line bg-bg px-3 py-2 text-ink" />
        </label>
        <button type="submit" disabled={estado === "enviando"}
          className="rounded-md bg-accent px-4 py-2 font-semibold text-panel disabled:opacity-50">
          {estado === "enviando" ? L("Entrando…", "Signing in…") : L("Entrar", "Sign in")}
        </button>
        {estado === "erro" && <p className="text-sm text-danger" role="alert">{erro}</p>}
      </form>
    </div>
  );
}

/** Registra a visita a cada rota aberta (só com sessão autorizada; ver lib/visitas.ts). */
function RegistroVisitas() {
  const { pathname } = useLocation();
  const { uf } = useUf();
  const { lang } = useLang();
  useEffect(() => { registrarVisita(pathname, uf, lang); }, [pathname, uf, lang]);
  return null;
}

function Rotas() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/c/:id" element={<CandidatePanel />} />
      <Route path="/comparativo" element={<Comparativo />} />
      <Route path="/dobrada" element={<Dobrada />} />
      <Route path="/presidente" element={<Presidente />} />
      <Route path="/publicidade" element={<Publicidade />} />
      <Route path="/digital-mg" element={<DigitalMG />} />
      <Route path="/mapa-mobilizacao" element={<Esperanca />} />
      <Route path="/esperanca" element={<Navigate to="/mapa-mobilizacao" replace />} />
      <Route path="/paineis" element={<Paineis />} />
      <Route path="/paineis/:id" element={<PainelView />} />
      <Route path="/metodologia" element={<Metodologia />} />
      <Route path="/acessos" element={<Acessos />} />
      <Route path="*" element={<p className="text-muted">{L("Página não encontrada.", "Page not found.")}</p>} />
    </Routes>
  );
}

function NaoAutorizado({ email, onSair }: { email?: string; onSair: () => void }) {
  return (
    <div className="grid min-h-full place-items-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-panel p-6" role="alert">
        <div className="eyebrow">{L("Acesso restrito à equipe", "Team-only access")}</div>
        <h1 className="display text-2xl">{L("E-mail não autorizado", "Email not authorized")}</h1>
        <p><b>{email}</b> {L("entrou, mas não está na lista de e-mails autorizados. Peça a um administrador para incluí-lo.",
          "signed in, but is not on the list of authorized emails. Ask an administrator to add it.")}</p>
        <button type="button" onClick={onSair} className="rounded-md border border-line px-4 py-2">{L("Sair", "Sign out")}</button>
      </div>
    </div>
  );
}

function configOk(): string | null {
  if (isDev) return null;
  try {
    supabase();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export default function App() {
  const erroConfig = configOk();
  if (erroConfig) {
    return (
      <div className="grid min-h-full place-items-center px-4">
        <div className="max-w-md rounded-lg border border-danger bg-panel p-6" role="alert">
          <h1 className="display text-2xl">{L("Painel sem configuração", "Dashboard not configured")}</h1>
          <p className="mt-2">{erroConfig}</p>
          <p className="mt-2 text-sm text-muted">{L("Na Vercel: Settings → Environment Variables, e depois um novo deploy.", "On Vercel: Settings → Environment Variables, then redeploy.")}</p>
        </div>
      </div>
    );
  }
  return <AppComSessao />;
}

function AppComSessao() {
  const [session, setSession] = useState<Session | null | undefined>(isDev ? null : undefined);
  const [autorizado, setAutorizado] = useState<boolean | undefined>(isDev ? true : undefined);
  useEffect(() => {
    if (isDev) return;
    void supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((_e, s) =>
      // mantém o mesmo objeto se o usuário não mudou (evita re-renderizar tudo a cada revalidação)
      setSession((prev) => (prev && s && prev.user.id === s.user.id ? prev : s)));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (isDev || !session) return;
    // Só checa de novo quando o usuário muda. Ao voltar para a aba o Supabase revalida o token e emite
    // uma sessão nova do mesmo usuário; resetar aqui fazia a tela inteira piscar e remontar.
    void supabase().rpc("autorizado").then(({ data, error }) => setAutorizado(!error && data === true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);
  const sair = () => void supabase().auth.signOut();

  return (
    <BrowserRouter>
      {isDev ? (
        <Shell><Rotas /></Shell>
      ) : session === undefined || (session && autorizado === undefined) ? (
        <p className="py-20 text-center text-muted">{L("Verificando acesso…", "Checking access…")}</p>
      ) : session && autorizado ? (
        <Shell onSair={sair}><RegistroVisitas /><Rotas /></Shell>
      ) : session ? (
        <NaoAutorizado email={session.user.email} onSair={sair} />
      ) : (
        <Login />
      )}
    </BrowserRouter>
  );
}
