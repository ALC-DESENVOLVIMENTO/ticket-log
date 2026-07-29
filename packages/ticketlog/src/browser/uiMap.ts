export const ticketLogUi = {
  home: {
    labels: /^\s*(?:in.cio|home|p.gina inicial)\s*$/i,
    selectors: [
      "a[href$='/home']",
      "a[href*='/home?']",
      "[routerlink='/home']",
      "[ng-reflect-router-link='/home']",
      "a.menu-pagina-inicial:not(.menu-pagina-inicial-carrinho)",
      "a[href*='GoodManagerSSL/Home2.cfm' i]",
      "a[title*='Pagina Inicial' i]",
      "a[title*='Página Inicial' i]",
    ],
  },
  vehicleQuickAccess: {
    labels: /^\s*(?:ve.culo|vehicle)\s*$/i,
  },
  eva: {
    launcherSelectors: [
      "#gea-gestor-eva-container",
      "#gea-gestor-eva-ativa-container",
      "#ge-gestor-eva-container",
      "#ge-gestor-eva-ativa-container",
      "#ge-fab",
      "#gea-fab",
      "#buttoneva",
      "#movebutton #ge-fab",
      "#ge-gestor-eva-container #ge-fab",
      "#gea-gestor-eva-container #ge-fab",
      "#gea-gestor-eva-container [role='button']",
      "#gea-gestor-eva-ativa-container [role='button']",
      "button.eva-button",
      "button[aria-label*='EVA' i]",
      "button[title*='EVA' i]",
    ],
    launcherRole: /eva|assistente virtual/i,
    launcherImageSelectors: [
      "img#fotoeva",
      "img#fotoevachat",
      "img[src*='eva' i]",
      "img[alt*='eva' i]",
      "#EVA-Ativada",
    ],
    frameHost: "eva-front.edenred.com.br",
    rootText:
      /sou a eva|i am eva|digite sobre o que deseja falar|type what you want|digite aqui sua d.vida|type your question|como deseja prosseguir|how do you want to proceed/i,
    rejectedPage:
      /the requested url was rejected|please consult with your administrator|your support id is/i,
    blockingPromptText:
      /posso ajudar|transa..o foi negada|liberar restri..o|fatura.*vence hoje|pegue a sua fatura/i,
    blockingPromptCloseSelectors: [
      "#gea-gestor-eva-ativa-container #button-x:visible",
      "#gea-gestor-eva-notificacoes-container #button-x-notificacao:visible",
      "#notificacao-central-eva-container #button-nao:visible",
      "#gea-gestor-eva-ativa-container #button-nao:visible",
      "#button-x:visible",
      "#button-x-notificacao:visible",
    ],
    panelCloseSelectors: [
      ".eva-header .eva-minimize:visible",
      ".eva-minimize:visible",
      "[class*='eva-header' i] [class*='minimize' i]:visible",
    ],
    transactions: /^(?:transa..es|transactions)(?:\s|$)/i,
    releaseFuelRestriction:
      /liberar abastecimento.*restri|release fuel.*restrict/i,
    platePrompt:
      /(?:digite|informe|cole).*(?:n.mero do cart.o|cart.o ou placa|placa)|card number or plate/i,
    releaseConfirmation:
      /libera..o conclu.da|abastecimento liberado|restri..o (?:foi )?liberada|libera..o da restri..o (?:foi )?(?:conclu.da|realizada)|fiz a libera..o da restri|release completed|fueling released|restriction released/i,
  },
} as const;

export function isEvaFrameCandidate(url: string, bodyText: string): boolean {
  return (
    url.includes(ticketLogUi.eva.frameHost) ||
    ticketLogUi.eva.rootText.test(bodyText) ||
    ticketLogUi.eva.rejectedPage.test(bodyText) ||
    ticketLogUi.eva.releaseConfirmation.test(bodyText)
  );
}

export function isEvaReleaseConfirmation(bodyText: string): boolean {
  return ticketLogUi.eva.releaseConfirmation.test(bodyText);
}
