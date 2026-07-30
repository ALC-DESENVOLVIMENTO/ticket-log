import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Copy,
  Clock,
  ExternalLink,
  History,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Square,
  TerminalSquare,
  UserPlus,
  Users,
} from "lucide-react";
import {
  approveToken,
  claimTicketLogOperation,
  createApprovalLink,
  createRequest,
  createUser,
  getApproval,
  getMe,
  getPublicConfig,
  getRequestDetails,
  getSessionToken,
  getTicketLogSessionStatus,
  listWhatsappSessions,
  listRequests,
  listUsers,
  login,
  rejectRequest,
  reopenWhatsappSession,
  logout,
  retryRequest,
  releaseTicketLogOperation,
  secondApprove,
  setSessionToken,
  setupMfa,
  verifyMfa,
} from "./api";
import "./styles.css";

type AppView = "request" | "history" | "operations" | "users";

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

type LegalPageKind = "privacy" | "terms";

function LegalPage({ kind }: { kind: LegalPageKind }) {
  const isPrivacy = kind === "privacy";

  return (
    <main className="legal-page">
      <header className="legal-header">
        <a href="/" aria-label="Voltar para o sistema">
          <BrandLockup compact />
        </a>
        <IntegrationBadge />
      </header>

      <article className="legal-document">
        <p className="legal-eyebrow">ALC & Pereira Filho Transportes</p>
        <h1>{isPrivacy ? "Politica de Privacidade" : "Termos de Servico"}</h1>
        <p className="legal-updated">Ultima atualizacao: 28 de julho de 2026</p>

        {isPrivacy ? (
          <>
            <section>
              <h2>1. Objetivo e controlador</h2>
              <p>
                Esta Politica explica como a ALC & Pereira Filho Transportes trata dados pessoais no sistema
                interno de solicitacao, aprovacao e acompanhamento de limites temporarios de abastecimento,
                inclusive quando o atendimento for iniciado pelo WhatsApp.
              </p>
              <p>
                A ALC & Pereira Filho Transportes e a controladora dos dados tratados para essa finalidade. O
                sistema e destinado exclusivamente a empregados, prestadores e administradores previamente
                autorizados.
              </p>
            </section>

            <section>
              <h2>2. Dados tratados</h2>
              <p>Podemos tratar as seguintes categorias de dados:</p>
              <ul>
                <li>nome, matricula, funcao e vinculo com a empresa;</li>
                <li>telefone vinculado ao WhatsApp e e-mail corporativo;</li>
                <li>credenciais protegidas, registros de MFA e informacoes de autenticacao;</li>
                <li>placa, grupo do veiculo, valor solicitado e justificativa operacional;</li>
                <li>aprovacoes, recusas, data, hora, canal de origem e status da solicitacao;</li>
                <li>logs de seguranca, auditoria, endereco IP e evidencias tecnicas;</li>
                <li>mensagens relacionadas ao atendimento e a execucao da solicitacao.</li>
              </ul>
              <p>O sistema nao solicita senhas da Ticket Log, codigos de MFA ou credenciais corporativas pelo WhatsApp.</p>
            </section>

            <section>
              <h2>3. Finalidades e bases legais</h2>
              <p>Os dados sao utilizados para:</p>
              <ul>
                <li>confirmar a identidade e as permissoes do solicitante;</li>
                <li>criar, aprovar, executar e acompanhar solicitacoes de abastecimento;</li>
                <li>prevenir fraude, duplicidade, uso indevido e alteracoes nao autorizadas;</li>
                <li>manter trilha de auditoria e atender obrigacoes legais e internas;</li>
                <li>investigar falhas, incidentes e divergencias operacionais;</li>
                <li>enviar atualizacoes sobre o andamento da solicitacao.</li>
              </ul>
              <p>
                O tratamento ocorre conforme as bases legais aplicaveis da LGPD, incluindo execucao de contratos
                e politicas internas, cumprimento de obrigacao legal ou regulatoria, exercicio regular de direitos
                e legitimo interesse, com avaliacao de necessidade e proporcionalidade.
              </p>
            </section>

            <section>
              <h2>4. Compartilhamento e operadores</h2>
              <p>
                Os dados podem ser compartilhados, no limite necessario, com fornecedores de infraestrutura,
                autenticacao, mensageria, monitoramento e armazenamento, bem como com a Meta/WhatsApp, Railway,
                Ticket Log/Edenred e outros prestadores envolvidos na operacao. Esses terceiros tratam dados de
                acordo com seus contratos, politicas e obrigacoes legais.
              </p>
              <p>Nao comercializamos dados pessoais.</p>
            </section>

            <section>
              <h2>5. Retencao, seguranca e transferencias</h2>
              <p>
                Os dados sao mantidos pelo periodo necessario para cumprir as finalidades descritas, as politicas
                de auditoria da empresa e as obrigacoes legais. Depois disso, sao eliminados ou anonimizados,
                salvo quando a conservacao for permitida ou exigida por lei.
              </p>
              <p>
                Aplicamos controle de acesso por funcao, MFA, criptografia, registros de auditoria, segregacao de
                servicos, protecao de segredos, monitoramento e prevencao de reprocessamentos. Nenhum sistema e
                totalmente imune a riscos, mas incidentes sao tratados conforme os procedimentos internos e a
                legislacao aplicavel.
              </p>
              <p>
                Alguns fornecedores podem processar dados fora do Brasil. Nesses casos, sao adotadas medidas
                compativeis com a LGPD para a transferencia internacional.
              </p>
            </section>

            <section>
              <h2>6. Direitos dos titulares</h2>
              <p>
                Nos termos da LGPD, o titular pode solicitar confirmacao do tratamento, acesso, correcao,
                informacoes sobre compartilhamento, anonimizacao, bloqueio, eliminacao quando cabivel e revisao
                de decisoes automatizadas.
              </p>
              <p>
                As solicitacoes devem ser encaminhadas ao setor administrativo ou ao responsavel por privacidade
                pelos canais oficiais da ALC & Pereira Filho Transportes. A identidade do solicitante podera ser
                confirmada antes do atendimento.
              </p>
            </section>

            <section>
              <h2>7. Cookies, menores e atualizacoes</h2>
              <p>
                O sistema utiliza armazenamento local e tecnologias estritamente necessarias para autenticacao,
                seguranca e continuidade da sessao. Ele nao e destinado a criancas ou adolescentes.
              </p>
              <p>
                Esta Politica pode ser atualizada para refletir mudancas legais, tecnicas ou operacionais. A data
                da versao vigente sera sempre informada nesta pagina.
              </p>
            </section>
          </>
        ) : (
          <>
            <section>
              <h2>1. Aceitacao e finalidade</h2>
              <p>
                Estes Termos regulam o uso do sistema interno da ALC & Pereira Filho Transportes para solicitar,
                aprovar e acompanhar alteracoes temporarias de limite de abastecimento. Ao utilizar o sistema ou
                iniciar uma solicitacao pelo WhatsApp, o usuario declara que leu e aceita estes Termos.
              </p>
            </section>

            <section>
              <h2>2. Elegibilidade e acesso</h2>
              <p>
                O acesso e restrito a usuarios previamente cadastrados e autorizados. O usuario deve utilizar sua
                propria conta, manter senha e fatores de autenticacao sob sigilo e comunicar imediatamente
                suspeitas de comprometimento.
              </p>
              <p>
                O numero de WhatsApp, isoladamente, nao comprova identidade. A aprovacao pode exigir login forte,
                MFA e, conforme a politica aplicavel, uma segunda aprovacao independente.
              </p>
            </section>

            <section>
              <h2>3. Uso permitido</h2>
              <p>O usuario se compromete a:</p>
              <ul>
                <li>informar placa, valor e justificativa corretos;</li>
                <li>solicitar valores apenas para necessidade operacional legitima;</li>
                <li>revisar os dados antes de aprovar;</li>
                <li>nao compartilhar links de aprovacao, contas ou codigos de autenticacao;</li>
                <li>nao tentar contornar limites, controles de seguranca ou trilhas de auditoria;</li>
                <li>comunicar erros ou alteracoes indevidas assim que identificados.</li>
              </ul>
            </section>

            <section>
              <h2>4. Processamento das solicitacoes</h2>
              <p>
                Uma solicitacao somente e considerada concluida quando a alteracao do limite e a liberacao de
                abastecimento pela EVA forem confirmadas. O sistema pode bloquear duplicidades, limitar valores,
                impedir operacoes simultaneas para a mesma placa ou encaminhar o caso para analise humana.
              </p>
              <p>
                Em caso de resposta ambigua da plataforma, o sistema pode interromper o fluxo e verificar o estado
                antes de qualquer nova tentativa. A alteracao de limite nao sera repetida quando nao houver
                evidencia suficiente de que a tentativa anterior falhou.
              </p>
            </section>

            <section>
              <h2>5. Ticket Log, EVA e terceiros</h2>
              <p>
                Ticket Log, Sou Log+, EVA, Edenred, Meta e WhatsApp sao servicos de terceiros e possuem termos e
                politicas proprios. Este sistema e uma ferramenta interna da ALC & Pereira Filho Transportes e nao
                representa um produto oficial desses terceiros.
              </p>
              <p>
                Mudancas de interface, indisponibilidade, CAPTCHA, MFA, bloqueios ou outras medidas de seguranca
                podem exigir intervencao humana. O sistema nao tenta contornar mecanismos antifraude ou de
                autenticacao.
              </p>
            </section>

            <section>
              <h2>6. Disponibilidade e responsabilidades</h2>
              <p>
                Empregamos monitoramento e controles de recuperacao, mas nao garantimos disponibilidade
                ininterrupta de servicos de terceiros. Em situacoes de falha, o usuario deve observar o processo
                manual de contingencia definido pela empresa.
              </p>
              <p>
                O usuario e responsavel pela veracidade da solicitacao e pelo uso de suas credenciais. A empresa
                pode suspender acessos, cancelar solicitacoes e apurar responsabilidades em caso de uso indevido.
              </p>
            </section>

            <section>
              <h2>7. Privacidade, auditoria e alteracoes</h2>
              <p>
                O tratamento de dados segue a Politica de Privacidade. Solicitacoes, aprovacoes, tentativas e
                resultados podem ser registrados para seguranca, auditoria e cumprimento de obrigacoes.
              </p>
              <p>
                Estes Termos podem ser atualizados por mudancas legais, tecnicas ou operacionais. A continuidade
                de uso apos a publicacao da nova versao representa aceitacao dos termos atualizados.
              </p>
            </section>

            <section>
              <h2>8. Legislacao e contato</h2>
              <p>
                Estes Termos sao regidos pelas leis brasileiras. Duvidas devem ser encaminhadas ao setor
                administrativo ou ao responsavel pelo sistema pelos canais oficiais da ALC & Pereira Filho
                Transportes.
              </p>
            </section>
          </>
        )}

        <footer className="legal-footer">
          <a href="/">Acessar o sistema</a>
          <a href="/politica-de-privacidade">Politica de Privacidade</a>
          <a href="/termos-de-servico">Termos de Servico</a>
        </footer>
      </article>
    </main>
  );
}

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function appDateTime(value: string | number | Date | undefined | null) {
  if (!value) return "n/d";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: import.meta.env.VITE_APP_TIME_ZONE ?? "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function shortProtocol(requestId: string | undefined) {
  const compact = String(requestId ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `TL-${(compact.slice(0, 8) || "SEMID")}`;
}

function hasCompletedStep(steps: any[], stepKey: string) {
  return steps.some((step) => step.step_key === stepKey && step.status === "DONE");
}

function hasFailedStep(steps: any[], stepKey: string) {
  return steps.some((step) => step.step_key === stepKey && step.status === "FAILED");
}

function displayRequestStatus(request: any, steps: any[] = []) {
  if (hasCompletedStep(steps, "CHANGE_LIMIT") && hasFailedStep(steps, "EVA_RELEASE")) {
    return "Aguardando liberação";
  }

  if (
    request?.new_limit &&
    request?.platform_result &&
    /ALTERACAO|LIMIT_VERIFIED|CONFIRMADA/i.test(String(request.platform_result)) &&
    ["FALHA_MANUAL", "FALHA_REPROCESSAVEL", "RESULTADO_INDETERMINADO"].includes(request?.status)
  ) {
    return "Aguardando liberação";
  }

  if (request?.status === "LIMITE_ALTERADO") {
    return "Aguardando liberação";
  }

  return getFriendlyStatus(request?.status);
}

function maskPhone(phoneE164: string | undefined) {
  if (!phoneE164) return "n/d";
  return phoneE164;
}

function ErrorBox({ error }: { error: string }) {
  return error ? <pre className="error">{error}</pre> : null;
}

function statusTone(status: string | undefined) {
  switch (status) {
    case "CONCLUIDA":
    case "Concluída":
    case "EVA_LIBERADA":
    case "EVA liberada":
    case "DONE":
    case "Concluído":
      return "success";
    case "EM_PROCESSAMENTO":
    case "Em processamento":
    case "NA_FILA":
    case "Na fila":
    case "LIMITE_ALTERADO":
    case "Limite alterado":
    case "RUNNING":
    case "Executando":
    case "PENDING":
    case "Pendente":
    case "Aguardando liberação":
      return "processing";
    case "FALHA_MANUAL":
    case "Falha manual":
    case "FALHA_REPROCESSAVEL":
    case "Falha reprocessável":
    case "RESULTADO_INDETERMINADO":
    case "Resultado indeterminado":
    case "FAILED":
    case "Falhou":
      return "warning";
    case "REJEITADA":
    case "Rejeitada":
    case "CANCELADA":
    case "Cancelada":
    case "EXPIRADA":
    case "Expirada":
      return "danger";
    default:
      return "neutral";
  }
}

function getFriendlyStatus(status: string | undefined) {
  const map: Record<string, string> = {
    RASCUNHO: "Rascunho",
    AGUARDANDO_AUTENTICACAO: "Aguardando autenticação",
    AGUARDANDO_APROVACAO: "Aguardando aprovação",
    AGUARDANDO_SEGUNDA_APROVACAO: "Aguardando segunda aprovação",
    NA_FILA: "Na fila",
    EM_PROCESSAMENTO: "Em processamento",
    LIMITE_ALTERADO: "Limite alterado",
    EVA_LIBERADA: "EVA liberada",
    CONCLUIDA: "Concluída",
    REJEITADA: "Rejeitada",
    EXPIRADA: "Expirada",
    CANCELADA: "Cancelada",
    FALHA_REPROCESSAVEL: "Falha reprocessável",
    FALHA_MANUAL: "Falha manual",
    RESULTADO_INDETERMINADO: "Resultado indeterminado",
  };
  return status ? map[status] ?? status : "n/d";
}

function getFriendlyStepName(stepKey: string) {
  const map: Record<string, string> = {
    CHANGE_LIMIT: "Alteração de limite",
    EVA_RELEASE: "Liberação EVA",
    AUTHENTICATE: "Autenticação Ticket Log",
    OPEN_VEHICLE_LIST: "Abrir veículos",
    SEARCH_PLATE: "Buscar placa",
    OPEN_PLATE: "Abrir veículo",
    READ_STATUS: "Verificar status",
    UNBLOCK_VEHICLE: "Desbloquear veículo",
    READ_CURRENT_LIMIT: "Ler limite atual",
  };
  return map[stepKey] ?? stepKey;
}

function getFriendlyStepStatus(status: string) {
  const map: Record<string, string> = {
    DONE: "Concluído",
    FAILED: "Falhou",
    RUNNING: "Executando",
    PENDING: "Pendente",
    SKIPPED: "Ignorado",
  };
  return map[status] ?? getFriendlyStatus(status);
}

function getFriendlyPlatformResult(result: string | undefined | null) {
  const map: Record<string, string> = {
    ALTERACAO_CONFIRMADA_PELA_TELA_DE_RESULTADO: "Alteração confirmada pela Ticket Log",
    ALTERACAO_CONFIRMADA_POR_LEITURA_DO_LIMITE: "Alteração confirmada pela leitura do limite",
    LIMIT_VERIFIED_AFTER_MANUAL_CHANGE: "Limite confirmado após intervenção manual",
  };
  return result ? map[result] ?? result : "Aguardando";
}

function getFriendlyErrorCode(errorCode: string | undefined | null) {
  const map: Record<string, string> = {
    VISIBLE_LOCATOR_NOT_FOUND: "Elemento esperado não encontrado na tela",
    CHANGE_LIMIT_CONFIRMATION_NOT_FOUND: "Confirmação da alteração não encontrada",
    EVA_PANEL_NOT_FOUND: "Painel da EVA não encontrado",
    HOME_ENTRYPOINT_NOT_FOUND: "Atalho da tela inicial não encontrado",
    TICKETLOG_SESSION_NOT_AUTHENTICATED: "Sessão Ticket Log não autenticada",
    EVA_URL_REJECTED: "EVA rejeitou a sessão atual",
  };
  return errorCode ? map[errorCode] ?? errorCode : "sem erro";
}

function getFriendlyChannel(channel: string | undefined | null) {
  const map: Record<string, string> = {
    whatsapp: "WhatsApp",
    web: "Portal web",
  };
  return channel ? map[channel] ?? channel : "n/d";
}

function getFriendlyProviderMode(providerMode: string | undefined | null) {
  const map: Record<string, string> = {
    browser: "Navegador",
    api: "API oficial",
    simulation: "Simulação",
  };
  return providerMode ? map[providerMode] ?? providerMode : "n/d";
}

function getFriendlySessionStatus(status: string | undefined | null) {
  const map: Record<string, string> = {
    STATION_READY: "Estação pronta",
    STATION_FAILED: "Falha na estação",
    AUTH_REQUIRED: "Login necessário",
    AUTHENTICATED: "Autenticada",
    ERROR: "Erro",
    UNKNOWN: "Desconhecida",
  };
  return status ? map[status] ?? getFriendlyStatus(status) : "n/d";
}

function getFriendlyWorkerStatus(status: string | undefined | null) {
  const map: Record<string, string> = {
    IDLE: "Ocioso",
    OFFLINE: "Offline",
    WAITING_OPERATOR: "Aguardando operador",
    DEGRADED: "Instável",
    STOPPING: "Encerrando",
    RUNNING: "Executando",
  };
  return status ? map[status] ?? getFriendlyStatus(status) : "Carregando";
}

function getFriendlyVehicleGroup(group: string | undefined | null) {
  const map: Record<string, string> = {
    GERAL_DE_RESTRICOES: "Geral de restrições",
    UTILITARIOS: "Utilitários",
    VEICULO_DE_PASSEIO: "Veículo de passeio",
    VAN: "Van",
    VUC: "VUC",
  };
  return group ? map[group] ?? group : "n/d";
}

function getFriendlyEventName(eventType: string) {
  const map: Record<string, string> = {
    REQUEST_STATE_CHANGED: "Status alterado",
    AUTOMATION_RETRY_EXHAUSTED: "Tentativas de automacao esgotadas",
    AUTOMATION_RETRY_SCHEDULED: "Nova tentativa agendada",
    AUTOMATION_COMPLETED: "Automação concluída",
    OPERATION_TAKEOVER_CLAIMED: "Assumido manualmente",
    REQUEST_REENQUEUED: "Solicitacao reenfileirada",
    APPROVAL_LINK_REISSUED: "Link de aprovacao reemitido",
    REQUEST_CREATED_OR_REUSED: "Solicitacao criada",
    REQUEST_APPROVAL_RECORDED: "Aprovacao registrada",
    WHATSAPP_REQUEST_CREATED: "Solicitação criada pelo WhatsApp",
    JOB_IGNORED_INVALID_STATE: "Job ignorado por status inválido",
  };
  return map[eventType] ?? eventType;
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
        <nav className="auth-legal-links" aria-label="Documentos legais">
          <a href="/politica-de-privacidade">Politica de Privacidade</a>
          <a href="/termos-de-servico">Termos de Servico</a>
        </nav>
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
            <dt>Grupo</dt><dd>{getFriendlyVehicleGroup(request.vehicleGroup)}</dd>
            <dt>Valor adicional</dt><dd>{money(request.requestedAmount)}</dd>
            <dt>Solicitante</dt><dd>{request.requesterName}</dd>
            <dt>Status</dt><dd>{getFriendlyStatus(request.status)}</dd>
            <dt>Expira em</dt><dd>{appDateTime(request.tokenExpiresAt)}</dd>
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
  user,
}: {
  publicConfig: any;
  onRequestCreated: (requestId: string) => void;
  user: any;
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
      {!user?.access?.canCreateWebRequest && (
        <div className="hint">
          Seu perfil possui acesso apenas de consulta no portal. Solicite alteracoes pelo WhatsApp ou acompanhe os protocolos criados.
        </div>
      )}
      <label>
        Placa
        <input value={plate} onChange={(event) => setPlate(event.target.value)} placeholder="ABC1D23" disabled={!user?.access?.canCreateWebRequest} />
      </label>
      <label>
        Grupo
        <select value={vehicleGroup} onChange={(event) => setVehicleGroup(event.target.value)} disabled={!user?.access?.canCreateWebRequest}>
          {(publicConfig?.vehicleGroups ?? []).map((group: any) => (
            <option key={group.key} value={group.key}>
              {group.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Valor adicional
        <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="350,00" disabled={!user?.access?.canCreateWebRequest} />
      </label>
      <span className="hint">
        {requiresSecondApprovalHint
          ? `Segunda aprovacao somente a partir de ${money(secondApprovalFrom)}. O link expira em ${publicConfig?.approvalTtlMinutes ?? 30} minutos.`
          : `Solicitacao com aprovacao unica para este grupo. O link expira em ${publicConfig?.approvalTtlMinutes ?? 30} minutos.`}
      </span>
      <label>
        Justificativa interna
        <textarea value={justification} onChange={(event) => setJustification(event.target.value)} disabled={!user?.access?.canCreateWebRequest} />
      </label>
      <button disabled={!user?.access?.canCreateWebRequest}>
        <CheckCircle2 size={18} />
        Criar solicitacao
      </button>
      {created && (
        <div className="result">
          <strong>Solicitacao criada</strong>
          <span>Protocolo: {shortProtocol(created.request.id)}</span>
          <span className="muted-line">ID interno: {created.request.id}</span>
          <span>Status: {getFriendlyStatus(created.request.status)}</span>
          <a href={created.approvalUrl}>Abrir link de aprovacao</a>
        </div>
      )}
      <ErrorBox error={createError} />
    </form>
  );
}

function StatusPanel({ initialLookupId = "", user }: { initialLookupId?: string; user: any }) {
  const [lookupId, setLookupId] = useState(initialLookupId);
  const [lookup, setLookup] = useState<any>(null);
  const [lookupError, setLookupError] = useState("");
  const [secondApprovalStatus, setSecondApprovalStatus] = useState("");
  const [retryStatus, setRetryStatus] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  useEffect(() => {
    if (!initialLookupId) return;
    setLookupId(initialLookupId);
    getRequestDetails(initialLookupId)
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
    setRetryStatus("");

    if (!lookupId.trim()) {
      setLookupError("INFORME_O_ID_DA_SOLICITACAO");
      return;
    }

    try {
      setLookup(await getRequestDetails(lookupId));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "REQUEST_LOOKUP_FAILED");
    }
  }

  useEffect(() => {
    if (!lookupId.trim()) return;
    if (!lookup) return;
    if (
      ["CONCLUIDA", "REJEITADA", "EXPIRADA", "CANCELADA", "FALHA_MANUAL", "RESULTADO_INDETERMINADO"].includes(
        lookup.request?.status ?? lookup.status,
      )
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      getRequestDetails(lookupId)
        .then(setLookup)
        .catch((err) => setLookupError(err instanceof Error ? err.message : "REQUEST_LOOKUP_FAILED"));
    }, 5000);

    return () => window.clearInterval(timer);
  }, [lookup, lookupId]);

  async function approveSecond() {
    setLookupError("");
    try {
      const result = await secondApprove(lookup.request.id);
      setSecondApprovalStatus(JSON.stringify(result));
      setLookup(await getRequestDetails(lookup.request.id));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "SECOND_APPROVAL_FAILED");
    }
  }

  async function openFirstApproval() {
    setLookupError("");
    try {
      const result = await createApprovalLink(request.id);
      window.location.assign(result.approvalUrl);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "APPROVAL_LINK_FAILED");
    }
  }

  async function retryCurrentRequest() {
    setLookupError("");
    setRetryStatus("");
    setRetrying(true);
    try {
      await retryRequest(lookup.request.id);
      setRetryStatus(
        lookup.request.status === "LIMITE_ALTERADO"
          ? "Retomada da EVA enfileirada. O status sera atualizado automaticamente."
          : "Solicitacao enfileirada. O status sera atualizado automaticamente.",
      );
      setLookup(await getRequestDetails(lookup.request.id));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "REQUEST_RETRY_FAILED");
    } finally {
      setRetrying(false);
    }
  }

  async function rejectCurrentRequest() {
    setLookupError("");
    try {
      const result = await rejectRequest(lookup.request.id, rejectionReason);
      setRetryStatus(JSON.stringify(result));
      setRejectionReason("");
      setLookup(await getRequestDetails(lookup.request.id));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "REQUEST_REJECTION_FAILED");
    }
  }

  const request = lookup?.request ?? lookup;
  const steps = lookup?.steps ?? [];
  const events = lookup?.events ?? [];
  const retryableStatuses = [
    "NA_FILA",
    "FALHA_REPROCESSAVEL",
    "FALHA_MANUAL",
    "RESULTADO_INDETERMINADO",
    "LIMITE_ALTERADO",
  ];
  const visualStatus = displayRequestStatus(request, steps);

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
        <div className="result detail-card">
          <div className="detail-headline">
            <div>
              <strong>{request.vehicle_plate} - {money(request.requested_amount)}</strong>
              <span className="muted-line">Protocolo: {shortProtocol(request.id)}</span>
              <span className="muted-line">ID interno: {request.id}</span>
            </div>
            <span className={`status-pill ${statusTone(visualStatus)}`}>{visualStatus}</span>
          </div>
          <div className="detail-grid">
            <span>Grupo: {getFriendlyVehicleGroup(request.vehicle_group)}</span>
            <span>Canal: {getFriendlyChannel(request.channel)}{request.requester_phone ? ` (${maskPhone(request.requester_phone)})` : ""}</span>
            <span>Limite anterior: {request.previous_limit ? money(request.previous_limit) : "n/d"}</span>
            <span>Novo limite: {request.new_limit ? money(request.new_limit) : "n/d"}</span>
            <span>Resultado plataforma: {getFriendlyPlatformResult(request.platform_result)}</span>
            <span>Criado em: {appDateTime(request.created_at)}</span>
          </div>
          <div className="action-row">
            {["AGUARDANDO_AUTENTICACAO", "AGUARDANDO_APROVACAO"].includes(request.status) && (
              <button type="button" onClick={openFirstApproval}>
                <CheckCircle2 size={18} />
                Abrir aprovacao
              </button>
            )}
            {request.status === "AGUARDANDO_SEGUNDA_APROVACAO" && user?.access?.canApproveRequests && (
              <button type="button" onClick={approveSecond}>
                <ShieldCheck size={18} />
                Fazer segunda aprovacao
              </button>
            )}
            {["AGUARDANDO_APROVACAO", "AGUARDANDO_SEGUNDA_APROVACAO"].includes(request.status) && user?.access?.canRejectRequests && (
              <button type="button" className="secondary" onClick={rejectCurrentRequest}>
                <Square size={16} />
                Rejeitar
              </button>
            )}
            {retryableStatuses.includes(request.status) && (
              <button type="button" className="secondary" onClick={retryCurrentRequest} disabled={retrying}>
                <RefreshCw size={18} className={retrying ? "spin" : undefined} />
                {retrying
                  ? "Enfileirando..."
                  : request.status === "NA_FILA"
                    ? "Reenfileirar"
                    : request.status === "LIMITE_ALTERADO"
                      ? "Retomar EVA"
                      : "Reprocessar"}
              </button>
            )}
          </div>
          {["AGUARDANDO_APROVACAO", "AGUARDANDO_SEGUNDA_APROVACAO"].includes(request.status) && user?.access?.canRejectRequests && (
            <label>
              Justificativa da rejeicao
              <textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Informe o motivo da rejeicao" />
            </label>
          )}
          {secondApprovalStatus && <code>{secondApprovalStatus}</code>}
          {retryStatus && <p className="status-message">{retryStatus}</p>}

          {steps.length > 0 && (
            <div className="timeline-block">
              <h3>Etapas da automacao</h3>
              <div className="timeline-list">
                {steps.map((step: any) => (
                  <div key={step.step_key} className="timeline-row step-row">
                    <strong>{getFriendlyStepName(step.step_key)}</strong>
                    <span className={`status-pill ${statusTone(step.status)}`}>{getFriendlyStepStatus(step.status)}</span>
                    <span>{getFriendlyErrorCode(step.error_code)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {events.length > 0 && (
            <div className="timeline-block">
              <h3>Auditoria recente</h3>
              <div className="timeline-list">
                {events.map((event: any, index: number) => (
                  <div key={`${event.event_type}-${index}`} className="timeline-row audit-row">
                    <strong>{getFriendlyEventName(event.event_type)}</strong>
                    <span>{appDateTime(event.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <ErrorBox error={lookupError} />
    </section>
  );
}

function HistoryPanel({ onSelectRequest }: { onSelectRequest: (requestId: string) => void }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const result = await listRequests(25);
      setRequests(result.requests ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "REQUEST_HISTORY_LOAD_FAILED");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Historico recente</h2>
        <span>Ultimas 25 solicitacoes</span>
      </div>
      <div className="action-row">
        <button type="button" className="secondary" onClick={refresh}>
          <RefreshCw size={18} />
          Atualizar lista
        </button>
      </div>
      <div className="table">
        {requests.map((request) => (
          <button key={request.id} type="button" className="request-row-button" onClick={() => onSelectRequest(request.id)}>
            <div className="row request-row">
              <div className="detail-headline">
                <strong>{request.vehicle_plate} - {money(request.requested_amount)}</strong>
                <span className={`status-pill ${statusTone(displayRequestStatus(request))}`}>{displayRequestStatus(request)}</span>
              </div>
              <span className="muted-line">Protocolo: {shortProtocol(request.id)}</span>
              <span>{getFriendlyVehicleGroup(request.vehicle_group)}</span>
            </div>
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
    </section>
  );
}

function OperationsPanel({ user }: { user: any }) {
  const [session, setSession] = useState<any>(null);
  const [whatsappSessions, setWhatsappSessions] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function refresh() {
    try {
      const [ticketlogSession, whatsapp] = await Promise.all([
        getTicketLogSessionStatus(),
        listWhatsappSessions(20),
      ]);
      setSession(ticketlogSession);
      setWhatsappSessions(whatsapp.sessions ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "TICKETLOG_SESSION_STATUS_FAILED");
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function claim() {
    setWorking(true);
    try {
      setSession(await claimTicketLogOperation());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "OPERATION_CLAIM_FAILED");
    } finally {
      setWorking(false);
    }
  }

  async function release() {
    setWorking(true);
    try {
      await releaseTicketLogOperation();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "OPERATION_RELEASE_FAILED");
    } finally {
      setWorking(false);
    }
  }

  async function resumeRequest() {
    if (!session?.currentRequestId) return;
    setWorking(true);
    try {
      await retryRequest(session.currentRequestId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "OPERATION_RESUME_FAILED");
    } finally {
      setWorking(false);
    }
  }

  async function copyStationPassword() {
    if (!session?.stationPassword) return;
    try {
      await navigator.clipboard.writeText(session.stationPassword);
      setError("");
    } catch {
      setError("Nao foi possivel copiar a senha. Selecione o campo e copie manualmente.");
    }
  }

  async function reopenConversation(phoneE164: string) {
    setWorking(true);
    try {
      await reopenWhatsappSession(phoneE164);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "WHATSAPP_SESSION_REOPEN_FAILED");
    } finally {
      setWorking(false);
    }
  }

  const isMine = session?.operator?.userId === user?.id;
  const heartbeat = session?.heartbeatAt ? appDateTime(session.heartbeatAt) : "nao recebido";

  return (
    <div className="operations-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>Estacao operacional Ticket Log</h2>
          <span className={`status-pill ${session?.workerStatus === "OFFLINE" ? "danger" : session?.workerStatus === "WAITING_OPERATOR" ? "warning" : "success"}`}>
            {getFriendlyWorkerStatus(session?.workerStatus)}
          </span>
        </div>
        {session && (
          <div className="result detail-card">
            <div className="detail-grid">
              <span>Provider: {getFriendlyProviderMode(session.providerMode)}</span>
              <span>Execucao real: {session.realExecutionEnabled ? "ativa" : "desligada"}</span>
              <span>Sessao: {getFriendlySessionStatus(session.sessionStatus)}</span>
              <span>Heartbeat: {heartbeat}</span>
              <span>Perfil persistente: {session.userDataDirPresent ? "presente" : "nao detectado"}</span>
              <span>Storage state: {session.storageStatePresent ? "presente" : "nao detectado"}</span>
              <span>Solicitacao: {session.currentRequestId ?? "nenhuma"}</span>
              <span>Status da solicitacao: {getFriendlyStatus(session.currentRequestStatus)}</span>
              <span>Etapa: {session.currentStep ? getFriendlyStepName(session.currentStep) : "Ocioso"}</span>
            </div>
            <div className={session.workerStatus === "WAITING_OPERATOR" ? "warning-box" : "hint"}>
              <strong>{session.statusMessage ?? session.message ?? "Aguardando atividade"}</strong>
              {session.challengeType && <span>Desafio detectado: {session.challengeType}</span>}
            </div>
            {session.operator && (
              <div className="operator-claim">
                Em uso por <strong>{session.operator.name ?? session.operator.userId}</strong>
              </div>
            )}
            <div className="action-row">
              <button type="button" className="secondary" onClick={refresh}>
                <RefreshCw size={18} />
                Atualizar estado
              </button>
              {!session.operator && session.stationAvailable && (
                <button type="button" onClick={claim} disabled={working}>
                  <TerminalSquare size={18} />
                  Assumir estacao
                </button>
              )}
              {isMine && (
                <button type="button" className="secondary" onClick={release} disabled={working}>
                  <Square size={16} />
                  Encerrar acesso
                </button>
              )}
              {isMine && session.currentRequestStatus === "FALHA_MANUAL" && (
                <button type="button" onClick={resumeRequest} disabled={working}>
                  <RefreshCw size={18} />
                  Retomar solicitacao
                </button>
              )}
            </div>
          </div>
        )}
        <ErrorBox error={error} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Fluxo do operador</h2>
          <span>Quando houver desafio</span>
        </div>
        <div className="timeline-list">
          <div className="timeline-row">
            <strong>1. Solicitação entra na fila</strong>
            <span>O backend tenta usar a sessao reaproveitada da Ticket Log.</span>
          </div>
          <div className="timeline-row">
            <strong>2. Edenred pede desafio</strong>
            <span>Captcha, SMS, trusted device ou OTP interrompem a execucao automatica.</span>
          </div>
          <div className="timeline-row">
            <strong>3. Operador autorizado assume</strong>
            <span>Dev, aprovador ou Luka concluem o login na estacao operacional e a automacao segue.</span>
          </div>
          <div className="timeline-row">
            <strong>4. Fluxo retoma do ponto seguro</strong>
            <span>Se o limite ja mudou, o sistema pula direto para EVA; se nao, continua da alteracao.</span>
          </div>
        </div>
      </section>

      <section className="panel station-panel">
        <div className="panel-title">
          <h2>Tela do navegador</h2>
          <span>Takeover humano</span>
        </div>
        {isMine && session?.stationUrl ? (
          <>
            <div className="station-toolbar">
              <div className="station-password">
                <label htmlFor="station-password">Senha VNC</label>
                <input
                  id="station-password"
                  type="password"
                  readOnly
                  value={session.stationPassword ?? ""}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="icon-button secondary"
                  onClick={copyStationPassword}
                  disabled={!session.stationPassword}
                  title="Copiar senha VNC"
                  aria-label="Copiar senha VNC"
                >
                  <Copy size={16} />
                </button>
              </div>
              <a href={session.stationUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                Abrir em nova aba
              </a>
            </div>
            <iframe
              className="station-frame"
              src={session.stationUrl}
              title="Estacao operacional Ticket Log"
              allow="clipboard-read; clipboard-write"
            />
          </>
        ) : (
          <div className="station-empty">
            <TerminalSquare size={36} />
            <strong>
              {session?.stationAvailable
                ? "Assuma a estacao para visualizar o navegador."
                : "Estacao remota ainda nao configurada no worker."}
            </strong>
            <span>A tela aparece aqui sem incorporar diretamente o dominio da Ticket Log.</span>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Sessoes WhatsApp</h2>
          <span>Triagem e retomada</span>
        </div>
        <div className="timeline-list">
          {whatsappSessions.length === 0 && (
            <div className="timeline-row">
              <strong>Nenhuma sessao recente</strong>
              <span>Quando um supervisor ou coordenador falar com o bot, ela aparece aqui.</span>
            </div>
          )}
          {whatsappSessions.map((item) => (
            <div key={item.phoneE164} className="timeline-row session-row">
              <strong>{maskPhone(item.phoneE164)} · {item.state}</strong>
              <span>
                {item.authenticatedUserName ?? "Nao autenticado"} · escopo {item.operationScope ?? "GERAL"}
              </span>
              <span>
                Ultima interacao: {appDateTime(item.lastInteractionAt)}
              </span>
              <span>
                Solicitação ativa: {item.activeRequestId ?? "nenhuma"}
              </span>
              <div className="action-row">
                {["EXPIRADO", "ERRO"].includes(item.state) && (
                  <button type="button" className="secondary" onClick={() => reopenConversation(item.phoneE164)} disabled={working}>
                    <RefreshCw size={18} />
                    Reabrir conversa
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    employeeNumber: "",
    corporateEmail: "",
    cpf: "",
    operationScope: "GERAL",
    phoneE164: "",
    password: "Alterar@123",
    roles: ["SUPERVISOR"],
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
        <label>CPF<input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" /></label>
        <label>Escopo<input value={form.operationScope} onChange={(e) => setForm({ ...form, operationScope: e.target.value })} placeholder="GERAL" /></label>
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
              <span>CPF: {user.cpf_last4 ? `***.***.***-${user.cpf_last4.slice(-2)}` : "pendente"}</span>
              <span>Escopo: {user.operation_scope ?? "GERAL"}</span>
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
  return (
    <main className="shell">
      <aside className="sidebar">
        <BrandLockup compact />
        <nav>
          <button className={view === "request" ? "active" : ""} onClick={() => setView("request")}><Clock size={16} /> Solicitacao</button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><History size={16} /> Historico</button>
          {user?.access?.canApproveRequests && (
            <button className={view === "operations" ? "active" : ""} onClick={() => setView("operations")}><TerminalSquare size={16} /> Operacao</button>
          )}
          {user?.access?.canManageUsers && (
            <button className={view === "users" ? "active" : ""} onClick={() => setView("users")}><Users size={16} /> Usuarios</button>
          )}
        </nav>
        <IntegrationBadge />
      </aside>

      <section className="content">
        <header>
          <div>
            <h1>Limite temporario</h1>
            <p>{publicConfig?.companyName ?? "ALC & Pereira Filho Transportes"} - ambiente <strong>{publicConfig?.executionMode ?? "operacional"}</strong></p>
          </div>
          <button className="secondary" onClick={onLogout}><LogOut size={18} /> Sair</button>
        </header>
        <p className="userline">Sessao: {user?.name} ({user?.email})</p>
        <p className="userline">Perfil: {(user?.roles ?? []).join(", ")} · Escopo: {user?.operationScope ?? "GERAL"}</p>
        {view === "request" && (
          <div className="grid">
            <RequestPanel publicConfig={publicConfig} onRequestCreated={setActiveRequestId} user={user} />
            <StatusPanel initialLookupId={activeRequestId} user={user} />
          </div>
        )}
        {view === "history" && (
          <div className="grid">
            <HistoryPanel onSelectRequest={setActiveRequestId} />
            <StatusPanel initialLookupId={activeRequestId} user={user} />
          </div>
        )}
        {view === "operations" && <OperationsPanel user={user} />}
        {view === "users" && user?.access?.canManageUsers && <UsersPanel />}
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
  const legalPage =
    window.location.pathname === "/politica-de-privacidade"
      ? "privacy"
      : window.location.pathname === "/termos-de-servico"
        ? "terms"
        : null;

  useEffect(() => {
    getPublicConfig().then(setPublicConfig).catch(() => undefined);
    if (getSessionToken()) {
      getMe().then((result) => setUser(result.user)).catch(() => setSessionToken(null));
    }
  }, []);

  if (legalPage) {
    return <LegalPage kind={legalPage} />;
  }

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
