import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Clock,
  History,
  LogOut,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import {
  approveToken,
  createRequest,
  createUser,
  getApproval,
  getMe,
  getPublicConfig,
  getRequest,
  getSessionToken,
  listUsers,
  login,
  logout,
  secondApprove,
  setSessionToken,
  setupMfa,
  verifyMfa,
} from "./api";
import "./styles.css";

type AppView = "request" | "history" | "users";

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand-lockup compact" : "brand-lockup"}>
      <img src="/alc-logo.png" alt="ALC Pereira Filho Transportes" />
      <div>
        <strong>ALC & Pereira Filho Transportes</strong>
        <span>Gestao segura de abastecimento</span>
      </div>
    </div>
  );
}

function IntegrationBadge() {
  return (
    <div className="integration-badge">
      <span>Integracao operacional</span>
      <div className="integration-logo-frame">
        <img src="/ticketlog-edenred-logo.png" alt="Ticket Log Edenred" />
      </div>
      <strong>Ticket Log / Edenred</strong>
    </div>
  );
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function ErrorBox({ error }: { error: string }) {
  return error ? <pre className="error">{error}</pre> : null;
}

function LoginView({ onLoggedIn }: { onLoggedIn: (requiresMfaSetup: boolean) => void }) {
  const [email, setEmail] = useState("dev@example.com");
  const [password, setPassword] = useState("Dev@123456");
  const [totpCode, setTotpCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const result = await login({ email, password, totpCode: mfaRequired ? totpCode : undefined });
      if (result.mfaRequired) {
        setMfaRequired(true);
        return;
      }
      setSessionToken(result.sessionToken);
      onLoggedIn(Boolean(result.requiresMfaSetup));
    } catch (err) {
      setError(err instanceof Error ? err.message : "LOGIN_FAILED");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <BrandLockup />
        <IntegrationBadge />
      </section>
      <form className="approval" onSubmit={submit}>
        <ShieldCheck size={36} />
        <h1>Entrar no sistema</h1>
        <p>Use seu e-mail corporativo, senha e Google Authenticator quando ja estiver configurado.</p>
        <label>
          E-mail
          <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
        </label>
        <label>
          Senha
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
        </label>
        {mfaRequired && (
          <label>
            Codigo MFA
            <input value={totpCode} onChange={(event) => setTotpCode(event.target.value)} inputMode="numeric" placeholder="000000" />
          </label>
        )}
        <button>
          <CheckCircle2 size={18} />
          Entrar
        </button>
        <ErrorBox error={error} />
      </form>
    </main>
  );
}

function MfaSetupView({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<any>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setupMfa().then(setSetup).catch((err) => setError(err instanceof Error ? err.message : "MFA_SETUP_FAILED"));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await verifyMfa(code);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "INVALID_MFA_CODE");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <BrandLockup />
        <IntegrationBadge />
      </section>
      <form className="approval" onSubmit={submit}>
        <ShieldCheck size={36} />
        <h1>Configurar Google Authenticator</h1>
        <p>Leia o QR Code no Google Authenticator e confirme com o codigo de 6 digitos.</p>
        {setup?.qrCodeDataUrl && <img className="qr" src={setup.qrCodeDataUrl} alt="QR Code MFA" />}
        {setup?.secret && <code className="secret">{setup.secret}</code>}
        <label>
          Codigo
          <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" placeholder="000000" />
        </label>
        <button>
          <CheckCircle2 size={18} />
          Ativar MFA
        </button>
        <ErrorBox error={error} />
      </form>
    </main>
  );
}

function ApprovalView({ token, onAuthNeeded }: { token: string; onAuthNeeded: () => void }) {
  const [approval, setApproval] = useState<any>(null);
  const [status, setStatus] = useState("AGUARDANDO_CONFIRMACAO");
  const [error, setError] = useState("");

  useEffect(() => {
    getApproval(token).then(setApproval).catch((err) => setError(err instanceof Error ? err.message : "APPROVAL_LOAD_FAILED"));
  }, [token]);

  async function approve() {
    setError("");
    if (!getSessionToken()) {
      onAuthNeeded();
      return;
    }
    try {
      const result = await approveToken(token);
      setStatus(result.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "APPROVAL_FAILED");
    }
  }

  const request = approval?.request;

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <BrandLockup />
        <IntegrationBadge />
      </section>
      <section className="approval">
        <ShieldCheck size={36} />
        <h1>Confirmar solicitacao</h1>
        <p>Revise os dados travados antes de aprovar. Esta tela nao altera placa nem valor.</p>
        {request && (
          <dl className="summary">
            <dt>Placa</dt><dd>{request.vehiclePlate}</dd>
            <dt>Grupo</dt><dd>{request.vehicleGroup}</dd>
            <dt>Valor adicional</dt><dd>{money(request.requestedAmount)}</dd>
            <dt>Solicitante</dt><dd>{request.requesterName}</dd>
            <dt>Status</dt><dd>{request.status}</dd>
            <dt>Expira em</dt><dd>{new Date(request.tokenExpiresAt).toLocaleString("pt-BR")}</dd>
          </dl>
        )}
        <button onClick={approve}>
          <CheckCircle2 size={18} />
          Aprovar
        </button>
        <span className="status">{status}</span>
        <ErrorBox error={error} />
      </section>
    </main>
  );
}

function RequestPanel({
  publicConfig,
  onRequestCreated,
}: {
  publicConfig: any;
  onRequestCreated: (requestId: string) => void;
}) {
  const [plate, setPlate] = useState("");
  const [vehicleGroup, setVehicleGroup] = useState("GERAL_DE_RESTRICOES");
  const [amount, setAmount] = useState("");
  const [justification, setJustification] = useState("");
  const [created, setCreated] = useState<any>(null);
  const [createError, setCreateError] = useState("");

  const selectedGroupPolicy = (publicConfig?.vehicleGroups ?? []).find((group: any) => group.key === vehicleGroup);
  const secondApprovalFrom = Number(selectedGroupPolicy?.requiresSecondApprovalFrom ?? 0);
  const requiresSecondApprovalHint = secondApprovalFrom > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setCreateError("");
    setCreated(null);
    try {
      const result = await createRequest({
        vehiclePlate: plate,
        vehicleGroup,
        requestedAmount: Number(amount.replace(",", ".")),
        justification,
      });
      setCreated(result);
      onRequestCreated(result.request.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "REQUEST_CREATE_FAILED");
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-title">
        <h2>Nova solicitacao web</h2>
        <span>Canal interno</span>
      </div>
      <label>
        Placa
        <input value={plate} onChange={(event) => setPlate(event.target.value)} placeholder="ABC1D23" />
      </label>
      <label>
        Grupo
        <select value={vehicleGroup} onChange={(event) => setVehicleGroup(event.target.value)}>
          {(publicConfig?.vehicleGroups ?? []).map((group: any) => (
            <option key={group.key} value={group.key}>
              {group.label} - limite {money(group.maxAmount)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Valor adicional
        <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="350,00" />
      </label>
      <span className="hint">
        {requiresSecondApprovalHint
          ? `Segunda aprovacao somente a partir de ${money(secondApprovalFrom)}. O link expira em ${publicConfig?.approvalTtlMinutes ?? 30} minutos.`
          : `Solicitacao com aprovacao unica para este grupo. O link expira em ${publicConfig?.approvalTtlMinutes ?? 30} minutos.`}
      </span>
      <label>
        Justificativa interna
        <textarea value={justification} onChange={(event) => setJustification(event.target.value)} />
      </label>
      <button>
        <CheckCircle2 size={18} />
        Criar solicitacao
      </button>
      {created && (
        <div className="result">
          <strong>Solicitacao criada</strong>
          <span>ID: {created.request.id}</span>
          <span>Status: {created.request.status}</span>
          <a href={created.approvalUrl}>Abrir link de aprovacao</a>
        </div>
      )}
      <ErrorBox error={createError} />
    </form>
  );
}

function StatusPanel({ initialLookupId = "" }: { initialLookupId?: string }) {
  const [lookupId, setLookupId] = useState(initialLookupId);
  const [lookup, setLookup] = useState<any>(null);
  const [lookupError, setLookupError] = useState("");
  const [secondApprovalStatus, setSecondApprovalStatus] = useState("");

  useEffect(() => {
    if (!initialLookupId) return;
    setLookupId(initialLookupId);
    getRequest(initialLookupId)
      .then((result) => {
        setLookup(result);
        setLookupError("");
      })
      .catch((err) => setLookupError(err instanceof Error ? err.message : "REQUEST_LOOKUP_FAILED"));
  }, [initialLookupId]);

  async function search() {
    setLookupError("");
    setLookup(null);
    setSecondApprovalStatus("");

    if (!lookupId.trim()) {
      setLookupError("INFORME_O_ID_DA_SOLICITACAO");
      return;
    }

    try {
      setLookup(await getRequest(lookupId));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "REQUEST_LOOKUP_FAILED");
    }
  }

  useEffect(() => {
    if (!lookupId.trim()) return;
    if (!lookup) return;
    if (["CONCLUIDA", "REJEITADA", "EXPIRADA", "CANCELADA", "FALHA_MANUAL", "RESULTADO_INDETERMINADO"].includes(lookup.status)) {
      return;
    }

    const timer = window.setInterval(() => {
      getRequest(lookupId)
        .then(setLookup)
        .catch((err) => setLookupError(err instanceof Error ? err.message : "REQUEST_LOOKUP_FAILED"));
    }, 5000);

    return () => window.clearInterval(timer);
  }, [lookup, lookupId]);

  async function approveSecond() {
    setLookupError("");
    try {
      const result = await secondApprove(lookup.id);
      setSecondApprovalStatus(JSON.stringify(result));
      setLookup(await getRequest(lookup.id));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "SECOND_APPROVAL_FAILED");
    }
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Status e segunda aprovacao</h2>
        <span>Fila operacional</span>
      </div>
      <div className="search">
        <input value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="ID da solicitacao" />
        <button type="button" onClick={search}>Buscar</button>
      </div>
      {lookup && (
        <div className="result">
          <strong>{lookup.vehicle_plate} - {money(lookup.requested_amount)}</strong>
          <span>Status: {lookup.status}</span>
          <span>Grupo: {lookup.vehicle_group}</span>
          {lookup.status === "AGUARDANDO_SEGUNDA_APROVACAO" && (
            <button type="button" onClick={approveSecond}>
              <ShieldCheck size={18} />
              Fazer segunda aprovacao
            </button>
          )}
          {secondApprovalStatus && <code>{secondApprovalStatus}</code>}
        </div>
      )}
      <ErrorBox error={lookupError} />
    </section>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    employeeNumber: "",
    corporateEmail: "",
    phoneE164: "",
    password: "Alterar@123",
    roles: ["SOLICITANTE", "APROVADOR"],
  });
  const [error, setError] = useState("");

  async function refresh() {
    const result = await listUsers();
    setUsers(result.users);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "USERS_LOAD_FAILED"));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await createUser(form);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "USER_CREATE_FAILED");
    }
  }

  return (
    <div className="grid">
      <form className="panel" onSubmit={submit}>
        <div className="panel-title">
          <h2>Novo usuario</h2>
          <span>Acesso e MFA</span>
        </div>
        <label>Nome<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Matricula<input value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} /></label>
        <label>E-mail<input value={form.corporateEmail} onChange={(e) => setForm({ ...form, corporateEmail: e.target.value })} /></label>
        <label>WhatsApp E.164<input value={form.phoneE164} onChange={(e) => setForm({ ...form, phoneE164: e.target.value })} placeholder="+5511999999999" /></label>
        <label>Senha inicial<input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <button><UserPlus size={18} /> Criar usuario</button>
        <ErrorBox error={error} />
      </form>
      <section className="panel">
        <div className="panel-title">
          <h2>Usuarios</h2>
          <span>Permissoes</span>
        </div>
        <div className="table">
          {users.map((user) => (
            <div className="row" key={user.id}>
              <strong>{user.name}</strong>
              <span>{user.corporate_email}</span>
              <span>MFA: {user.mfa_enabled ? "ativo" : "pendente"}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Dashboard({ user, publicConfig, onLogout }: { user: any; publicConfig: any; onLogout: () => void }) {
  const [view, setView] = useState<AppView>("request");
  const [activeRequestId, setActiveRequestId] = useState("");
  const mode = useMemo(() => import.meta.env.VITE_TICKETLOG_MODE ?? "simulation", []);

  return (
    <main className="shell">
      <aside className="sidebar">
        <BrandLockup compact />
        <nav>
          <button className={view === "request" ? "active" : ""} onClick={() => setView("request")}><Clock size={16} /> Solicitacao</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><History size={16} /> Historico</button>
          <button className={view === "users" ? "active" : ""} onClick={() => setView("users")}><Users size={16} /> Usuarios</button>
        </nav>
        <IntegrationBadge />
      </aside>

      <section className="content">
        <header>
          <div>
            <h1>Limite temporario</h1>
            <p>{publicConfig?.companyName ?? "ALC & Pereira Filho Transportes"} - modo <strong>{mode}</strong></p>
          </div>
          <button className="secondary" onClick={onLogout}><LogOut size={18} /> Sair</button>
        </header>
        <p className="userline">Sessao: {user?.name} ({user?.email})</p>
        {view === "request" && (
          <div className="grid">
            <RequestPanel publicConfig={publicConfig} onRequestCreated={setActiveRequestId} />
            <StatusPanel initialLookupId={activeRequestId} />
          </div>
        )}
        {view === "history" && <StatusPanel initialLookupId={activeRequestId} />}
        {view === "users" && <UsersPanel />}
      </section>
    </main>
  );
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [publicConfig, setPublicConfig] = useState<any>(null);
  const [requiresMfaSetup, setRequiresMfaSetup] = useState(false);
  const [authNeeded, setAuthNeeded] = useState(false);
  const token = window.location.pathname.match(/^\/approval\/([^/]+)/)?.[1];

  useEffect(() => {
    getPublicConfig().then(setPublicConfig).catch(() => undefined);
    if (getSessionToken()) {
      getMe().then((result) => setUser(result.user)).catch(() => setSessionToken(null));
    }
  }, []);

  async function afterLogin(needsMfa: boolean) {
    const result = await getMe();
    setUser(result.user);
    setRequiresMfaSetup(needsMfa);
    setAuthNeeded(false);
  }

  async function signOut() {
    await logout().catch(() => undefined);
    setSessionToken(null);
    setUser(null);
  }

  if (authNeeded || (!user && !token)) {
    return <LoginView onLoggedIn={afterLogin} />;
  }

  if (requiresMfaSetup) {
    return <MfaSetupView onDone={() => setRequiresMfaSetup(false)} />;
  }

  if (token) {
    return <ApprovalView token={token} onAuthNeeded={() => setAuthNeeded(true)} />;
  }

  return <Dashboard user={user} publicConfig={publicConfig} onLogout={signOut} />;
}

createRoot(document.getElementById("root")!).render(<App />);
