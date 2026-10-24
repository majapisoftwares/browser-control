export function createController(api) {
  async function groupTab(tabId) {
    const tab = await api.tabs.get(tabId);
    const groups = await api.tabGroups.query({ title: 'AI', windowId: tab.windowId });
    const groupId = await api.tabs.group(groups.length
      ? { tabIds: [tabId], groupId: groups[0].id }
      : { tabIds: [tabId], createProperties: { windowId: tab.windowId } });
    await api.tabGroups.update(groupId, { title: 'AI', color: 'purple', collapsed: false });
    return tab;
  }
  async function managedTab(tabId) {
    if (!Number.isInteger(tabId)) throw new Error('tabId must be an integer');
    const tab = await api.tabs.get(tabId);
    const group = tab.groupId >= 0 ? await api.tabGroups.get(tab.groupId) : null;
    if (group?.title !== 'AI') throw new Error('Use tabs.adopt first: automation is restricted to the AI group');
    return tab;
  }
  async function cdp(tabId, method, params = {}) {
    try { await api.debugger.attach({ tabId }, '1.3'); }
    catch (error) { if (!String(error.message).includes('Already attached')) throw error; }
    return api.debugger.sendCommand({ tabId }, method, params);
  }
  async function inject(tabId, func, args = []) {
    const results = await api.scripting.executeScript({ target: { tabId }, func, args });
    return results[0]?.result;
  }
  return async function execute(command) {
    const { action, tabId } = command;
    if (action === 'tabs.list') {
      const groups = await api.tabGroups.query({ title: 'AI' });
      const ids = new Set(groups.map(group => group.id));
      return (await api.tabs.query({})).map(tab => ({ id: tab.id, title: tab.title, url: tab.url, windowId: tab.windowId, automated: ids.has(tab.groupId), status: tab.status }));
    }
    if (action === 'tabs.create') {
      if (!/^https?:\/\//.test(command.url || '')) throw new Error('An HTTP(S) URL is required');
      const tab = await api.tabs.create({ url: 'about:blank', active: true });
      await groupTab(tab.id);
      await api.tabs.update(tab.id, { url: command.url });
      return { tabId: tab.id };
    }
    if (action === 'tabs.adopt') {
      await groupTab(tabId);
      return { tabId };
    }
    await managedTab(tabId);
    if (action === 'tabs.close') { await api.tabs.remove(tabId); return { closed: true }; }
    if (action === 'tabs.navigate') {
      if (!/^https?:\/\//.test(command.url || '')) throw new Error('An HTTP(S) URL is required');
      await api.tabs.update(tabId, { url: command.url }); return { navigating: true };
    }
    if (action === 'tabs.reload') { await api.tabs.reload(tabId); return { reloading: true }; }
    if (action === 'page.snapshot') return inject(tabId, () => {
      const nodes = [...document.querySelectorAll('a,button,input,textarea,select,summary,[role],[contenteditable="true"]')]
        .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').slice(0, 400);
      globalThis.__browserControlNodes = nodes;
      return {
        url: location.href, title: document.title, readyState: document.readyState,
        text: document.body.innerText.slice(0, 24000),
        elements: nodes.map((node, index) => ({ ref: index, tag: node.tagName.toLowerCase(), role: node.getAttribute('role'),
          label: node.getAttribute('aria-label') || node.labels?.[0]?.innerText || node.getAttribute('placeholder') || node.innerText?.slice(0, 160) || '',
          type: node.getAttribute('type'), disabled: !!node.disabled, href: node.getAttribute('href') })),
      };
    });
    if (action === 'page.click' || action === 'page.fill' || action === 'page.select') {
      return inject(tabId, (action, ref, selector, value) => {
        const node = selector ? document.querySelector(selector) : globalThis.__browserControlNodes?.[ref];
        if (!node?.isConnected) throw new Error('Element not found; take a new snapshot');
        if (node.disabled) throw new Error('Element is disabled');
        node.scrollIntoView({ block: 'center' }); node.focus();
        if (action === 'page.click') node.click();
        else {
          if (node instanceof HTMLSelectElement) node.value = value;
          else if (node.isContentEditable) node.textContent = value;
          else {
            const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (!setter) throw new Error('Element cannot be filled');
            setter.call(node, value);
          }
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { ok: true };
      }, [action, command.ref, command.selector, command.value]);
    }
    if (action === 'page.scroll') return inject(tabId, (x, y) => { window.scrollBy(x, y); return { x: scrollX, y: scrollY }; }, [command.x ?? 0, command.y ?? 600]);
    if (action === 'page.evaluate') {
      const result = await cdp(tabId, 'Runtime.evaluate', { expression: command.expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Page evaluation failed');
      return result.result.value ?? null;
    }
    if (action === 'page.screenshot') return cdp(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (action === 'page.type') { await cdp(tabId, 'Input.insertText', { text: command.text }); return { ok: true }; }
    if (action === 'page.key') {
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: command.key, code: command.code, windowsVirtualKeyCode: command.keyCode, modifiers: command.modifiers || 0 });
      await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: command.key, code: command.code, windowsVirtualKeyCode: command.keyCode, modifiers: command.modifiers || 0 });
      return { ok: true };
    }
    if (action === 'page.clickAt') {
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: command.x, y: command.y, button: 'left', clickCount: 1 });
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: command.x, y: command.y, button: 'left', clickCount: 1 });
      return { ok: true };
    }
    if (action === 'page.detach') { await api.debugger.detach({ tabId }); return { ok: true }; }
    throw new Error(`Unknown action: ${action}`);
  };
}
