chrome.runtime.onConnect.addListener(
    function(safePort) { // passthrough so the content script & iframe script can talk
        if (safePort.name.substring(0, 10) !== "safe-port-") return;

        unsafePort = chrome.tabs.connect(safePort.sender.tab.id, { name: "unsafe-" + safePort.name.substring(5) });

        // TODO make reactive operators
        unsafePort.onMessage.addListener(function(data) {
            console.log("data from unsafePort", data);
            safePort.postMessage(data);
        });

        safePort.onMessage.addListener(function(data) {
            console.log("data from safePort", data);
            unsafePort.postMessage(data);
        });
    });
