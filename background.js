chrome.action.onClicked.addListener((tab) => {
    // Send a message to the content script in the active tab to manually trigger a copy
    chrome.tabs.sendMessage(tab.id, { type: "MANUAL_TRIGGER" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Hilfe: Could not send message to tab. Refresh the page first.");
        }
    });
});
