export const ticketLogUi = {
  home: {
    labels: /^\s*(?:in.cio|home)\s*$/i,
    selectors: [
      "a[href$='/home']",
      "a[href*='/home?']",
      "[routerlink='/home']",
      "[ng-reflect-router-link='/home']",
    ],
  },
  vehicleQuickAccess: {
    labels: /^\s*(?:ve.culo|vehicle)\s*$/i,
  },
  eva: {
    launcherSelectors: [
      "#ge-fab",
      "#gea-fab",
      "#buttoneva",
      "#movebutton #ge-fab",
      "#ge-gestor-eva-container #ge-fab",
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
      /sou a eva|i am eva|digite sobre o que deseja falar|type what you want|digite aqui sua d.vida|type your question/i,
    transactions: /^(?:transa..es|transactions)(?:\s|$)/i,
    releaseFuelRestriction:
      /liberar abastecimento.*restri|release fuel.*restrict/i,
    releaseConfirmation:
      /libera..o conclu.da|abastecimento liberado|restri..o (?:foi )?liberada|libera..o da restri..o (?:foi )?(?:conclu.da|realizada)|fiz a libera..o da restri|release completed|fueling released|restriction released/i,
  },
} as const;

export function isEvaFrameCandidate(url: string, bodyText: string): boolean {
  return url.includes(ticketLogUi.eva.frameHost) || ticketLogUi.eva.rootText.test(bodyText);
}

export function isEvaReleaseConfirmation(bodyText: string): boolean {
  return ticketLogUi.eva.releaseConfirmation.test(bodyText);
}
