"use strict";

(function() {
    var paramPieces = window.location.search.substring(1).split("-");
    var ownId = paramPieces[0];
    var id = paramPieces[1];

    console.log("iframe online between", ownId, " and ", id);

    // TODO share makeName from fbotr.js (these ids are already escaped for "-" anyway, though)
    var port = chrome.runtime.connect({ name: "safe-port-" + ownId + "-" + id });

    var displayMsg = function(msg, own) {
        var rowEl = document.createElement("div");
        rowEl.className = "row";

        var msgEl = document.createElement("div");
        msgEl.innerText = msg;
        msgEl.className = "message";
        if (own) msgEl.className += " own";
        rowEl.appendChild(msgEl);

        var msgs = document.getElementById("messages");
        msgs.appendChild(rowEl);
        msgs.scrollTop = msgs.scrollHeight;

        return msgEl;
    };

    port.onMessage.addListener(function(data) {
        console.log("iframe got", data);
        if (data.type === 'recv') {
            displayMsg(data.msg, false);
        } else if (data.type === 'recvOwn') {
            displayMsg(data.msg, true);
        }
    });

    window.onload = function() {
        var entry = document.getElementById("entry");

        autogrow(entry);

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

    // from http://georgepapadakis.me/demo/expanding-textarea.html
    var autogrow = function(t) {
        var resize = function(t) {
            var lines = t.value.split("\n").length;

            t.style.height = (25 + 11.5 * (lines - 1)) + 'px';
        };

        t.addEventListener('input', function(event) {
            resize(t);
        });
    };
})();
