// background.js - Service Worker
// 点击扩展图标 → 发送 togglePanel 消息到 content script

chrome.runtime.onInstalled.addListener(() => {
  console.log('[VideoSpeed] Extension installed');
});

// 点击图标时，向当前标签页发送 togglePanel 消息
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // 先尝试注入 content script（应对首次安装时页面已加载的情况）
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      // 可能已经注入过，忽略
    }

    // 同样注入 CSS
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['panel.css']
      });
    } catch (e) {
      // 可能已经注入过，忽略
    }

    // 发送切换消息
    chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  } catch (e) {
    console.warn('[VideoSpeed] togglePanel failed', e);
  }
});

// 备用下载通道
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'download') {
    chrome.downloads.download({
      url: msg.dataUrl,
      filename: msg.filename,
      saveAs: false
    }, (id) => {
      sendResponse({ success: !!id, downloadId: id });
    });
    return true;
  }
});
