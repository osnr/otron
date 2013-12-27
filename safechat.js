(function() {
    var chatId = window.location.search.substring(1);

    console.log("iframe online with id", chatId);

    var port = chrome.runtime.connect({ name: "safe-port-" + chatId });

    var displayMsg = function(msg, own) {
        var msgEl = document.createElement("div");
        msgEl.innerText = msg;
        msgEl.className = "message"
        document.body.appendChild(msgEl);

        if (own) msgEl.className += " own";

        return msgEl;
    };

    port.onMessage.addListener(function(data) {
        console.log("iframe got", data);
        if (data.type === "recv") {
            displayMsg(data.msg, false);
        }
    });

    window.onload = function() {
        entry = document.getElementById("entry");
        entry.onkeydown = function(e) {
            if (e.keyCode === 13 && !e.shiftKey) {
                var msg = entry.value;

                port.postMessage({ type: "send",
                                   msg: msg });
                displayMsg(msg, true);

                entry.value = "";
                return false;
            }
        };
    };
})();
