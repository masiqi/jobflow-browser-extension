import { canonicalJobUrl } from "../filters";
import type { DetailJob, ListCandidate } from "../types";

const text = (root: ParentNode, selector: string): string => {
  const element = composedQueryAll<HTMLElement>(root, selector)[0];
  return (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
};
const LIEPIN_CHAT_SURFACE_TIMEOUT_MS = 15_000;
const LIEPIN_GREETING_EVIDENCE_TIMEOUT_MS = 15_000;
const LIEPIN_CLICK_ASSUMPTION_GRACE_MS = 1_000;

export function isLiepinListPage(location: Location = window.location): boolean {
  if (!/(^|\.)liepin\.com$/.test(location.hostname)) return false;
  return location.pathname === "/zhaopin/"
    || (location.hostname === "c.liepin.com" && location.pathname === "/");
}

export function isLiepinDetailPage(location: Location = window.location): boolean {
  return /(^|\.)liepin\.com$/.test(location.hostname) && /\/(?:job|a)\/\d+\.shtml/i.test(location.pathname);
}

export type LiepinBlockedPage = "login_required" | "risk_control" | "job_unavailable";

export function detectLiepinBlockedPage(
  root: ParentNode = document,
  pageLocation: Location = window.location
): LiepinBlockedPage | null {
  const source = root instanceof Document ? root.body?.textContent : root.textContent;
  const value = (source || "").replace(/\s+/g, " ").slice(0, 20_000);
  const unavailableBanner = text(root, ".stop-apply-header");
  if (/(?:该)?职位(?:已)?(?:暂停招聘|停止招聘|下线|过期|不存在)/.test(unavailableBanner)) return "job_unavailable";
  if (root instanceof Document && /安全中心.*风险提示/.test(root.title)) return "risk_control";
  if (pageLocation.hostname === "safe.liepin.com" && /(?:^|\/)(?:intercept|verifysms)(?:\/|$)/i.test(pageLocation.pathname)) {
    return "risk_control";
  }
  if (/安全验证|拖动滑块|访问异常|操作频繁|验证码|风险验证/.test(value)) return "risk_control";
  if (/登录后查看|请先登录|扫码登录|密码登录/.test(value)) return "login_required";
  return null;
}

export function liepinBlockedPageReason(blocked: LiepinBlockedPage): string {
  if (blocked === "risk_control") return "猎聘详情页需要安全验证";
  if (blocked === "login_required") return "猎聘详情页需要登录";
  return "猎聘职位已暂停招聘或不可用";
}

export type LiepinReviewedSendBlocker =
  | LiepinBlockedPage
  | "wrong_job"
  | "not_detail_page"
  | "missing_action"
  | "ambiguous_action"
  | "disabled_action"
  | "ambiguous_resume";

export interface LiepinReviewedSendPreflight {
  ok: boolean;
  platformJobId: string;
  resumeMode: "platform_default";
  actionTier?: "primary" | "secondary" | "application_confirmation";
  blocker?: LiepinReviewedSendBlocker;
  reason?: string;
}

export interface LiepinReviewedSendResult {
  ok: boolean;
  application: "attempted" | "verified" | "failed";
  greeting: "attempted" | "verified" | "failed";
  evidenceCodes: string[];
  reason?: string;
}

const normalizeMessageText = (value: string): string => value.replace(/\s+/g, " ").trim();

function isRenderableElement(element: HTMLElement, checkPointerEvents: boolean): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style && (
      style.display === "none"
      || style.visibility === "hidden"
      || style.visibility === "collapse"
      || checkPointerEvents && style.pointerEvents === "none"
    )) return false;
    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }
    const root = current.getRootNode();
    current = root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
  }
  return true;
}

function isRenderedElement(element: HTMLElement): boolean {
  return isRenderableElement(element, false);
}

function isVisibleElement(element: HTMLElement): boolean {
  return isRenderableElement(element, true);
}

function composedQueryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  const visitedScopes = new Set<Node>();
  const matches = new Set<T>();
  const visit = (scope: ParentNode): void => {
    if (visitedScopes.has(scope)) return;
    visitedScopes.add(scope);
    for (const element of scope.querySelectorAll<T>(selector)) matches.add(element);
    for (const element of scope.querySelectorAll<HTMLElement>("*")) {
      if (element.shadowRoot) visit(element.shadowRoot);
      if (element.tagName === "IFRAME") {
        try {
          const frameDocument = (element as HTMLIFrameElement).contentDocument;
          if (frameDocument && isRenderedElement(element)) visit(frameDocument);
        } catch {
          // Cross-origin frames are intentionally outside the content-script boundary.
        }
      }
    }
  };
  visit(root);
  return [...matches];
}

function isDisabledElement(element: HTMLElement): boolean {
  return element.hasAttribute("disabled")
    || element.getAttribute("aria-disabled") === "true"
    || /\b(disabled|disable)\b/i.test(element.className);
}

function matchesLiepinActionJobId(actionJobId: string | undefined, platformJobId: string): boolean {
  if (!actionJobId) return false;
  if (actionJobId === platformJobId) return true;
  return /^\d{8}$/.test(actionJobId)
    && /^\d{9,}$/.test(platformJobId)
    && platformJobId.endsWith(actionJobId);
}

function actionCandidates(root: ParentNode, platformJobId: string, tier: "primary" | "secondary"): HTMLElement[] {
  const selector = tier === "primary"
    ? 'a.btn-main[data-selector="chat-chat"],button.btn-main[data-selector="chat-chat"]'
    : 'a.btn-chat[data-selector="chat-chat"],button.btn-chat[data-selector="chat-chat"]';
  return composedQueryAll<HTMLElement>(root, selector)
    .filter((element) => matchesLiepinActionJobId(element.dataset.jobid, platformJobId))
    .filter(isVisibleElement);
}

function selectAction(root: ParentNode, platformJobId: string): { ok: true; element: HTMLElement; tier: "primary" | "secondary" } | { ok: false; blocker: LiepinReviewedSendBlocker; reason: string } {
  const primary = actionCandidates(root, platformJobId, "primary");
  const secondary = primary.length === 0 ? actionCandidates(root, platformJobId, "secondary") : [];
  const selected = primary.length > 0 ? primary : secondary;
  const tier = primary.length > 0 ? "primary" : "secondary";
  if (selected.length === 0) return { ok: false, blocker: "missing_action", reason: "未找到可用的聊一聊入口" };
  if (selected.length > 1) return { ok: false, blocker: "ambiguous_action", reason: "聊一聊入口不唯一" };
  if (isDisabledElement(selected[0]!)) return { ok: false, blocker: "disabled_action", reason: "聊一聊入口不可用" };
  return { ok: true, element: selected[0]!, tier };
}

type ApplicationConfirmation =
  | { status: "ready"; control: HTMLElement }
  | { status: "ambiguous" }
  | null;

function findApplicationConfirmation(root: ParentNode): ApplicationConfirmation {
  const source = (root instanceof Document ? root.body?.textContent : root.textContent) || "";
  const textValue = source.replace(/\s+/g, " ").slice(0, 20_000);
  const hasPickerText = /请选择简历|选择(?:附件)?简历|切换简历/.test(textValue);
  const controls = composedQueryAll<HTMLElement>(root, "button,a,[role=button]")
    .filter(isRenderedElement)
    .filter((element) => !isDisabledElement(element))
    .filter((element) => elementLabel(element) === "立即投递");
  if (!hasPickerText && controls.length === 0) return null;
  if (controls.length !== 1) return { status: "ambiguous" };
  let scope = controls[0]!.parentElement;
  while (scope?.parentElement && scope.parentElement !== controls[0]!.ownerDocument.body) {
    if (/选择(?:附件)?简历/.test(elementLabel(scope))) break;
    scope = scope.parentElement;
  }
  const radios = scope ? composedQueryAll<HTMLInputElement>(scope, 'input[type="radio"]') : [];
  const selected = radios.filter((radio) => radio.checked || radio.getAttribute("aria-checked") === "true");
  if (radios.length > 0 && selected.length !== 1) return { status: "ambiguous" };
  if (radios.length === 0 && !/默认在线简历|默认简历|当前简历/.test(scope ? elementLabel(scope) : textValue)) {
    return { status: "ambiguous" };
  }
  return { status: "ready", control: controls[0]! };
}

function hasAmbiguousResumePicker(root: ParentNode): boolean {
  return findApplicationConfirmation(root)?.status === "ambiguous";
}

export function preflightLiepinReviewedSend(
  root: ParentNode = document,
  href = location.href,
  platformJobId: string
): LiepinReviewedSendPreflight {
  const blocked = detectLiepinBlockedPage(root);
  if (blocked) {
    return {
      ok: false,
      platformJobId,
      resumeMode: "platform_default",
      blocker: blocked,
      reason: liepinBlockedPageReason(blocked)
    };
  }
  if (!/\/(?:job|a)\/\d+\.shtml/i.test(new URL(href).pathname)) {
    return { ok: false, platformJobId, resumeMode: "platform_default", blocker: "not_detail_page", reason: "当前不是猎聘职位详情页" };
  }
  if (jobIdFromUrl(href) !== platformJobId) {
    return { ok: false, platformJobId, resumeMode: "platform_default", blocker: "wrong_job", reason: "当前详情页职位 ID 不匹配" };
  }
  const applicationConfirmation = findApplicationConfirmation(root);
  if (applicationConfirmation?.status === "ambiguous") {
    return { ok: false, platformJobId, resumeMode: "platform_default", blocker: "ambiguous_resume", reason: "猎聘默认简历选择不明确" };
  }
  if (applicationConfirmation?.status === "ready") {
    return {
      ok: true,
      platformJobId,
      resumeMode: "platform_default",
      actionTier: "application_confirmation"
    };
  }
  const action = selectAction(root, platformJobId);
  if (!action.ok) {
    return { ok: false, platformJobId, resumeMode: "platform_default", blocker: action.blocker, reason: action.reason };
  }
  return {
    ok: true,
    platformJobId,
    resumeMode: "platform_default",
    actionTier: action.tier
  };
}

function dispatchAllowedClick(element: HTMLElement): void {
  const ViewMouseEvent = element.ownerDocument.defaultView?.MouseEvent ?? MouseEvent;
  element.dispatchEvent(new ViewMouseEvent("click", {
    bubbles: true,
    cancelable: true
  }));
}

function setTextControlValue(element: HTMLElement, value: string): void {
  const view = element.ownerDocument.defaultView;
  const isTextArea = Boolean(view && element instanceof view.HTMLTextAreaElement);
  const isInput = Boolean(view && element instanceof view.HTMLInputElement);
  if (isTextArea || isInput) {
    const prototype = isTextArea ? view!.HTMLTextAreaElement.prototype : view!.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else (element as HTMLTextAreaElement | HTMLInputElement).value = value;
  } else {
    element.textContent = value;
  }
  const ViewInputEvent = element.ownerDocument.defaultView?.InputEvent ?? InputEvent;
  const ViewEvent = element.ownerDocument.defaultView?.Event ?? Event;
  element.dispatchEvent(new ViewInputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  element.dispatchEvent(new ViewEvent("change", { bubbles: true }));
}

function applicationVerified(
  root: ParentNode,
  platformJobId: string,
  chatEvidenceRoot?: ParentNode
): boolean {
  const textValue = ((root instanceof Document ? root.body?.textContent : root.textContent) || "").replace(/\s+/g, " ");
  const statusPattern = "已投递|投递成功|已申请|申请成功|简历已发送|已发送简历|发送了简历";
  return new RegExp("(" + statusPattern + ").{0,80}" + platformJobId + "|" + platformJobId + ".{0,80}(" + statusPattern + ")").test(textValue)
    || composedQueryAll<HTMLElement>(root, "[data-jobid]")
      .filter((element) => matchesLiepinActionJobId(element.dataset.jobid, platformJobId))
      .some((element) => /已投递|投递成功|已申请|申请成功|简历已发送|已发送简历|发送了简历/.test(element.innerText || element.textContent || ""))
    || Boolean(chatEvidenceRoot && applicationEvidenceTexts(chatEvidenceRoot).size > 0);
}

function applicationEvidenceTexts(root: ParentNode): Set<string> {
  return new Set(
    composedQueryAll<HTMLElement>(root, "*")
      .filter((element) => element.children.length === 0)
      .filter(isVisibleElement)
      .map(elementLabel)
      .filter((value) => /简历(?:已发送|已投递|投递成功)|(?:已发送|已投递|发送了).*简历|个人简历|我的简历|在线简历|附件简历/.test(value))
  );
}

function newApplicationEvidence(root: ParentNode, before: Set<string>): boolean {
  return [...applicationEvidenceTexts(root)].some((value) => !before.has(value));
}

function elementLabel(element: HTMLElement): string {
  return normalizeMessageText(
    element.innerText
      || element.textContent
      || element.getAttribute("aria-label")
      || element.getAttribute("title")
      || ""
  );
}

function visibleTextControls(root: ParentNode): HTMLElement[] {
  const selectors = [
    "textarea:not([disabled])",
    'input[type="text"]:not([disabled])',
    '[contenteditable="true"]'
  ];
  return selectors.flatMap((selector) => composedQueryAll<HTMLElement>(root, selector))
    .filter(isRenderedElement);
}

function visibleSendControls(root: ParentNode): HTMLElement[] {
  return composedQueryAll<HTMLElement>(root, "button,a")
    .filter(isRenderedElement)
    .filter((element) => elementLabel(element) === "发送");
}

function nearestComposedAncestor(element: HTMLElement, selector: string): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.matches(selector)) return current;
    if (current.parentElement) {
      current = current.parentElement;
      continue;
    }
    const root = current.getRootNode();
    current = root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
  }
  return null;
}

function findResumeControl(root: ParentNode): HTMLElement | null {
  const candidates = composedQueryAll<HTMLElement>(root, "button,a,[role=button],div,span")
    .filter(isVisibleElement)
    .filter((element) => elementLabel(element) === "发简历")
    .filter((element) => ![...element.children].some((child) => elementLabel(child as HTMLElement) === "发简历"));
  return candidates.length === 1 ? candidates[0]! : null;
}

interface LiepinChatSurface {
  root: HTMLElement;
  composer: HTMLElement;
  send: HTMLElement;
}

function knownLiepinChatSurfaces(root: ParentNode): LiepinChatSurface[] {
  return composedQueryAll<HTMLElement>(root, ".im-ui-chat-input")
    .filter(isRenderedElement)
    .map((surfaceRoot): LiepinChatSurface | null => {
      const composers = composedQueryAll<HTMLElement>(surfaceRoot, "textarea.im-ui-textarea:not([disabled])")
        .filter(isRenderedElement);
      const sendControls = composedQueryAll<HTMLElement>(surfaceRoot, ".im-ui-basic-send-btn")
        .filter(isRenderedElement);
      if (composers.length !== 1 || sendControls.length !== 1) return null;
      const chatRoot = nearestComposedAncestor(surfaceRoot, ".im-ui-chat-container") || surfaceRoot;
      return { root: chatRoot, composer: composers[0]!, send: sendControls[0]! };
    })
    .filter((surface): surface is LiepinChatSurface => Boolean(surface));
}

function chatSurfaceForComposer(composer: HTMLElement): LiepinChatSurface | null {
  let scope = composer.parentElement;
  let selected: LiepinChatSurface | null = null;
  while (scope && scope !== composer.ownerDocument.body) {
    const sendControls = visibleSendControls(scope);
    const textControls = visibleTextControls(scope);
    if (sendControls.length === 1 && textControls.length === 1 && textControls[0] === composer) {
      selected = { root: scope, composer, send: sendControls[0]! };
    }
    scope = scope.parentElement;
  }
  return selected;
}

function findNewChatSurface(root: ParentNode, existingControls: Set<HTMLElement>): LiepinChatSurface | null {
  const knownSurfaces = knownLiepinChatSurfaces(root)
    .filter((surface) => !existingControls.has(surface.composer));
  if (knownSurfaces.length > 0) return knownSurfaces.length === 1 ? knownSurfaces[0]! : null;
  const surfaces = visibleTextControls(root)
    .filter((control) => !existingControls.has(control))
    .map(chatSurfaceForComposer)
    .filter((surface): surface is LiepinChatSurface => Boolean(surface));
  return surfaces.length === 1 ? surfaces[0]! : null;
}

function findExistingChatSurface(root: ParentNode): LiepinChatSurface | null {
  const knownSurfaces = knownLiepinChatSurfaces(root);
  if (knownSurfaces.length > 0) return knownSurfaces.length === 1 ? knownSurfaces[0]! : null;
  const surfaces = visibleTextControls(root)
    .map(chatSurfaceForComposer)
    .filter((surface): surface is LiepinChatSurface => Boolean(surface));
  return surfaces.length === 1 ? surfaces[0]! : null;
}

async function waitForNewChatSurface(
  root: ParentNode,
  existingControls: Set<HTMLElement>,
  timeoutMs: number
): Promise<LiepinChatSurface | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const surface = findNewChatSurface(root, existingControls);
    if (surface || hasAmbiguousResumePicker(root)) return surface;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function isEditableElement(element: HTMLElement): boolean {
  return element.matches('textarea,input,[contenteditable="true"]')
    || Boolean(element.closest('textarea,input,[contenteditable="true"]'));
}

function normalizedElementText(element: HTMLElement): string {
  return normalizeMessageText(element.innerText || element.textContent || "");
}

function hasOutboundMessageMarker(element: HTMLElement): boolean {
  const markerValues = [
    element.className,
    element.getAttribute("data-direction"),
    element.getAttribute("data-message-direction"),
    element.getAttribute("data-sender"),
    element.getAttribute("data-owner"),
    element.getAttribute("data-is-self"),
    element.getAttribute("data-self"),
    element.getAttribute("data-message-owner"),
    element.getAttribute("aria-label")
  ].filter((value): value is string => Boolean(value));
  return markerValues.some((value) => /(?:^|[-_\s])(self|mine|right|out|outgoing|outbound|send|sent|我|己方|本人)(?:$|[-_\s])/i.test(value)
    || /(?:^|[-_\s])0(?:$|[-_\s])/.test(value));
}

function isMessageLikeElement(element: HTMLElement): boolean {
  if (hasOutboundMessageMarker(element)) return true;
  let parent = element.parentElement;
  while (parent) {
    if (hasOutboundMessageMarker(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function containsExactText(element: HTMLElement, expected: string): boolean {
  if (isEditableElement(element) || !isRenderedElement(element)) return false;
  if (normalizedElementText(element) === expected) return true;
  return composedQueryAll<HTMLElement>(element, "*")
    .filter((child) => !isEditableElement(child))
    .filter(isRenderedElement)
    .some((child) => normalizedElementText(child) === expected);
}

function outboundGreetingVerified(root: ParentNode, draftText: string): boolean {
  const expected = normalizeMessageText(draftText);
  const allElements = composedQueryAll<HTMLElement>(root, "*")
    .filter((element) => !isEditableElement(element))
    .filter(isRenderedElement);
  const knownSelectors = [
    ".message-self",
    ".message-mine",
    ".chat-message-self",
    ".chat-message-right",
    ".im-ui-txt.im-ui-send",
    '[class*="im-ui-txt"][class*="im-ui-send"]',
    '[class*="message"][class*="self"]',
    '[class*="message"][class*="mine"]',
    '[class*="message"][class*="right"]'
  ];
  if (knownSelectors.some((selector) => composedQueryAll<HTMLElement>(root, selector)
    .filter((element) => !isEditableElement(element))
    .filter(isRenderedElement)
    .some((element) => containsExactText(element, expected)))) {
    return true;
  }
  const markedMessages = allElements.filter(isMessageLikeElement);
  if (markedMessages.some((element) => containsExactText(element, expected))) return true;
  return false;
}

async function waitForObservation(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export async function executeLiepinReviewedSend(
  root: ParentNode = document,
  href = location.href,
  platformJobId: string,
  draftText: string,
  needsApplication = true,
  needsGreeting = true,
  assumeClickSuccess = false
): Promise<LiepinReviewedSendResult> {
  if (!needsApplication && !needsGreeting) {
    return {
      ok: true,
      application: "verified",
      greeting: "verified",
      evidenceCodes: ["no_missing_component"]
    };
  }
  const preflight = preflightLiepinReviewedSend(root, href, platformJobId);
  if (!preflight.ok) {
    return {
      ok: false,
      application: "failed",
      greeting: "failed",
      evidenceCodes: [preflight.blocker || "preflight_failed"],
      reason: preflight.reason || "发送前检查失败"
    };
  }
  const applicationEvidenceBefore = applicationEvidenceTexts(root);
  let applicationConfirmation = findApplicationConfirmation(root);
  let surface = findExistingChatSurface(root);
  let reusedChatSurface = Boolean(surface);
  let applicationSubmitClicked = false;
  let greetingSendClicked = false;
  if (!surface && applicationConfirmation?.status !== "ready") {
    const action = selectAction(root, platformJobId);
    if (!action.ok) {
      return {
        ok: false,
        application: "failed",
        greeting: "failed",
        evidenceCodes: [action.blocker],
        reason: action.reason
      };
    }
    const existingControls = new Set(visibleTextControls(root));
    dispatchAllowedClick(action.element);
    surface = await waitForNewChatSurface(root, existingControls, LIEPIN_CHAT_SURFACE_TIMEOUT_MS);
    reusedChatSurface = false;
  }
  let application: LiepinReviewedSendResult["application"] = !needsApplication
    ? "verified"
    : applicationVerified(root, platformJobId, surface?.root)
    ? "verified"
    : "attempted";
  if (needsApplication && application !== "verified" && surface) {
    const resumeControl = findResumeControl(surface.root);
    if (resumeControl) {
      dispatchAllowedClick(resumeControl);
      await waitForObservation(
        () => applicationVerified(root, platformJobId, surface.root)
          || newApplicationEvidence(root, applicationEvidenceBefore)
          || Boolean(findApplicationConfirmation(root)),
        2500
      );
      applicationConfirmation = findApplicationConfirmation(root);
    }
  }
  if (needsApplication && application !== "verified" && applicationConfirmation?.status === "ready") {
    applicationSubmitClicked = true;
    dispatchAllowedClick(applicationConfirmation.control);
    if (!assumeClickSuccess) {
      await waitForObservation(
        () => applicationVerified(root, platformJobId, surface?.root) || newApplicationEvidence(root, applicationEvidenceBefore),
        4000
      );
    } else {
      await new Promise((resolve) => setTimeout(resolve, LIEPIN_CLICK_ASSUMPTION_GRACE_MS));
    }
  }
  application = !needsApplication
    ? "verified"
    : applicationVerified(root, platformJobId, surface?.root) || newApplicationEvidence(root, applicationEvidenceBefore)
    ? "verified"
    : "attempted";
  const applicationEvidenceCode = application === "verified"
    ? "application_status_verified"
    : applicationSubmitClicked
      ? "application_submit_clicked"
      : "native_action_attempted";
  if (hasAmbiguousResumePicker(root)) {
    return {
      ok: false,
      application,
      greeting: "failed",
      evidenceCodes: [application === "verified" ? "application_status_verified" : "native_action_attempted", "ambiguous_resume"],
      reason: "猎聘默认简历选择不明确"
    };
  }
  if (needsGreeting && surface && outboundGreetingVerified(surface.root, draftText)) {
    return {
      ok: application === "verified",
      application,
      greeting: "verified",
      evidenceCodes: [
        applicationEvidenceCode,
        "outbound_greeting_exact_match",
        reusedChatSurface ? "chat_surface_reused" : "chat_surface_opened"
      ]
    };
  }
  if (!needsGreeting) {
    return {
      ok: application === "verified",
      application,
      greeting: "verified",
      evidenceCodes: [
        applicationEvidenceCode,
        "greeting_already_verified",
        reusedChatSurface ? "chat_surface_reused" : "chat_surface_opened"
      ]
    };
  }
  if (!surface) {
    return {
      ok: false,
      application,
      greeting: "failed",
      evidenceCodes: [applicationEvidenceCode, "composer_missing"],
      reason: "聊一聊后未找到可填写的消息框"
    };
  }
  setTextControlValue(surface.composer, draftText);
  const sendEnabled = await waitForObservation(() => !isDisabledElement(surface!.send), 2000);
  if (!sendEnabled) {
    return {
      ok: false,
      application,
      greeting: "failed",
      evidenceCodes: [applicationEvidenceCode, "send_control_disabled"],
      reason: "填写招呼语后发送按钮仍不可用"
    };
  }
  dispatchAllowedClick(surface.send);
  greetingSendClicked = true;
  if (assumeClickSuccess) {
    await new Promise((resolve) => setTimeout(resolve, LIEPIN_CLICK_ASSUMPTION_GRACE_MS));
  }
  const greetingObserved = assumeClickSuccess
    ? outboundGreetingVerified(surface.root, draftText)
    : await waitForObservation(
      () => outboundGreetingVerified(surface.root, draftText),
      LIEPIN_GREETING_EVIDENCE_TIMEOUT_MS
    );
  const greeting = greetingObserved
    ? "verified"
    : "attempted";
  return {
    ok: application === "verified" && greeting === "verified",
    application,
    greeting,
    evidenceCodes: [
      applicationEvidenceCode,
      greeting === "verified" ? "outbound_greeting_exact_match" : "outbound_greeting_unverified",
      ...(greetingSendClicked ? ["greeting_send_clicked"] : []),
      reusedChatSurface ? "chat_surface_reused" : "chat_surface_opened"
    ]
  };
}

function jobIdFromUrl(url: string): string {
  return url.match(/\/(?:job|a)\/(\d+)\.shtml/i)?.[1] || "";
}

function pageTitleJob(href: string): string {
  if (!jobIdFromUrl(href)) return "";
  return document.title.match(/【[^】]*\s+(.+?)招聘】/)?.[1]?.trim() || "";
}

function bodyLine(body: Element | ParentNode, predicate: (line: string) => boolean): string {
  const root = body instanceof Document ? body : body.ownerDocument || document;
  const leafLines = [...root.querySelectorAll<HTMLElement>("body *")]
    .filter((node) => node.children.length === 0)
    .map((node) => (node.innerText || node.textContent || "").trim())
    .filter(Boolean);
  const line = leafLines.find((value) => predicate(value));
  if (line) return line;
  const source = body instanceof Element ? ((body as HTMLElement).innerText || body.textContent || "") : (root.body?.innerText || body.textContent || "");
  return source.split(/\n+/).map((value) => value.trim()).find((value) => predicate(value)) || "";
}

export function scanLiepinList(root: ParentNode = document): ListCandidate[] {
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href*=".shtml"]')].filter((anchor) => /\/(?:job|a)\/\d+\.shtml/i.test(anchor.href));
  const seen = new Set<string>();
  const candidates: ListCandidate[] = [];
  for (const anchor of anchors) {
    const jobId = jobIdFromUrl(anchor.href);
    if (!jobId || seen.has(jobId)) continue;
    const card = anchor.closest<HTMLElement>(".job-card-pc-container") || anchor.parentElement?.parentElement?.parentElement;
    if (!card) continue;
    const detailBox = anchor.closest<HTMLElement>(".job-detail-box") || anchor;
    const lines = [...anchor.querySelectorAll<HTMLElement>("*")]
      .filter((node) => node.children.length === 0)
      .map((node) => (node.innerText || node.textContent || "").trim())
      .filter(Boolean)
      .filter((value) => value !== "【" && value !== "】" && value !== "急聘");
    const recruiter = text(card, ".recruiter-info-box");
    const companyArea = text(card, '[data-nick="job-detail-company-info"]');
    const title = text(anchor, '[title^="招聘"]') || lines[0] || "";
    const location = (lines.find((value) => /北京|上海|广州|深圳|杭州|成都|武汉|西安|南京|天津|重庆|苏州|全国/.test(value)) || "")
      .replace(/[【】]/g, "")
      .trim();
    const salary = lines.find((value) => /\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?\s*k|\d+\s*[-~至]\s*\d+\s*万|面议/i.test(value)) || "";
    const experience = lines.find((value) => /经验不限|应届|实习|\d+年以上|\d+-\d+年/.test(value)) || "";
    const education = lines.find((value) => /本科|硕士|博士|大专|学历不限/.test(value)) || "";
    const company = [...card.querySelectorAll<HTMLElement>('[data-nick="job-detail-company-info"] span')].map((node) => (node.innerText || node.textContent || "").trim()).find(Boolean) || companyArea.split(/\s+/)[0] || "";
    const canonicalUrl = canonicalJobUrl(anchor.href);
    seen.add(jobId);
    const cardText = ((card.innerText || card.textContent || "") + " " + recruiter)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
    candidates.push({ platform: "liepin", jobId, url: anchor.href, canonicalUrl, title, company, location, salary, experience, education, cardText, index: candidates.length });
  }
  return candidates;
}

export function extractLiepinDetail(root: ParentNode = document, href = location.href): DetailJob | null {
  const jobId = jobIdFromUrl(href);
  if (!jobId) return null;
  const body = root instanceof Document ? root.body : root.querySelector("body") || root;
  const bodyText = (body.textContent || "").replace(/\s+/g, " ").trim();
  const title = text(root, ".job-apply-content h1") || text(root, ".job-title-box h1") || text(root, ".job-detail-header h1") || text(root, ".job-title") || pageTitleJob(href) || bodyLine(body, (line) => line.length <= 80 && !/首页|职位|登录|招聘/.test(line));
  const description = text(root, ".job-intro-container .paragraph") || text(root, ".job-description .content") || text(root, ".job-detail-content") || text(root, ".job-intro-container");
  if (!title || description.length < 20) return null;
  const salary = text(root, ".job-salary") || bodyText.match(/\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?\s*k(?:·\d+薪)?/i)?.[0] || "";
  const propertyText = text(root, ".job-properties") || text(root, ".job-info");
  const locationText = propertyText.match(/北京(?:-[^\s]+)?|上海(?:-[^\s]+)?|广州(?:-[^\s]+)?|深圳(?:-[^\s]+)?|杭州(?:-[^\s]+)?/)?.[0] || "";
  const recruiterCareer = bodyLine(body, (line) => /(?:HR|招聘|猎头|顾问).*[·]|[·].*(?:HR|招聘|猎头|顾问)/i.test(line));
  const company = text(root, ".company-card .company-name") || text(root, ".company-info .company-name") || text(root, ".job-company-info h3") || text(root, ".company-name") || recruiterCareer.split(/[·]/).slice(-1)[0]?.trim() || "";
  const recruiterLine = bodyLine(body, (line) => /^[\p{Script=Han}]{1,4}(?:先生|女士)/u.test(line));
  const recruiter = text(root, ".recruiter-info .name") || text(root, ".recruiter-card .name") || text(root, ".hunter-info .name") || recruiterLine.match(/^[\p{Script=Han}]{1,4}(?:先生|女士)/u)?.[0] || "";
  return {
    platform: "liepin", jobId, url: href, canonicalUrl: canonicalJobUrl(href), title, company,
    location: locationText, salary,
    experience: propertyText.match(/经验不限|应届|实习|\d+年以上|\d+-\d+年/)?.[0] || "",
    education: propertyText.match(/统招本科|本科|硕士|博士|大专|学历不限/)?.[0] || "",
    cardText: bodyText.slice(0, 1500), index: 0, description: description.slice(0, 60_000),
    recruiter,
    recruiterTitle: text(root, ".recruiter-info .title") || text(root, ".recruiter-card .position") || text(root, ".hunter-info .title") || recruiterCareer.split(/[·]/)[0]?.trim() || ""
  };
}
