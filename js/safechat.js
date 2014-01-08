"use strict";

window.onload = function() {
    var entry = document.getElementById("entry");

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

    autogrow(entry);
};

window.addEventListener('message', function(event) {
    if (event.data.type !== 'initPackage') return;
    console.log(event.data);

    var ownId = event.data.ownId;
    var id = event.data.id;
    var profilePhoto = event.data.profilePhoto;
    var oldMessages = event.data.messages;

    var akeSuccess = function(fingerprint, trust, prevFingerprints) {
        document.getElementById("overlay").style.display = "none";
        console.log("akeSuccess", fingerprint, trust, prevFingerprints);
    };

    var displayMsg = function(msg, own, encrypted) {
        var rowEl = document.createElement("div");
        rowEl.className = "row";

        if (!own) {
            var profilePhotoEl = document.createElement("img");
            profilePhotoEl.className = "profilePhoto";
            profilePhotoEl.src = profilePhoto;
            rowEl.appendChild(profilePhotoEl);
        }

        var msgEl = document.createElement("div");
        msgEl.innerText = msg;
        msgEl.className = "message";
        if (own) msgEl.className += " own";
        if (encrypted) msgEl.className += " encrypted";
        rowEl.appendChild(msgEl);

        var msgs = document.getElementById("messages");
        msgs.appendChild(rowEl);
        msgs.scrollTop = msgs.scrollHeight;

        return msgEl;
    };

    console.log("iframe online between", ownId, " and ", id);

    for (var i = 0; i < oldMessages.length; i++) {
        displayMsg(oldMessages[i].msg, oldMessages[i].own, false);
    }

    // TODO share makeName from shared.js (these ids are already escaped for "-" anyway, though)
    var port = chrome.runtime.connect({ name: "safePort-" + ownId + "-" + id });

    document.getElementById("entry").onkeydown = function(e) {
        if (e.keyCode === 13 && !e.shiftKey) {
            var msg = entry.value;

            port.postMessage({ type: "send",
                               msg: msg });

            entry.value = "";
            return false;
        }
    };

    port.onMessage.addListener(function(data) {
        console.log("iframe got", data);
        if (data.type === 'akeSuccess') {
            akeSuccess(data.fingerprint, data.trust, data.prevFingerprints);
        } else if (data.type === 'recv') {
            displayMsg(data.msg, false, data.encrypted);
        } else if (data.type === 'recvOwn') {
            displayMsg(data.msg, true, true); // all messages sent from safechat are encrypted
        }
    });
});
