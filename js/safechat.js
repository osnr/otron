"use strict";

$(document).ready(function() {
    // from http://georgepapadakis.me/demo/expanding-textarea.html
    var resize = function(t) {
        var lines = t.value.split("\n").length;

        t.style.height = (25 + 11.5 * (lines - 1)) + 'px';
    };

    $("#entry").on('input', function(event) {
        resize(this);
    });
});

window.addEventListener('message', function(event) {
    if (event.data.type !== 'initPackage') return;
    console.log(event.data);

    var ownId = event.data.ownId;
    var id = event.data.id;
    var profilePhoto = event.data.profilePhoto;
    if (profilePhoto.substring(0, 5) !== "data:") profilePhoto = "";
    var oldMessages = event.data.messages;

    $("#initial").show();
    var handleStatus = {
        sentQuery: function(data) {
            $(".overlay").hide();
            $("#sentQuery").show();
        },
        akeInit: function(data) {
            $(".overlay").hide();
            $("#akeInit").show();
        },
        akeSuccess: function(data) {
            $(".overlay").hide();
            console.log("akeSuccess", data.fingerprint, data.trust, data.prevFingerprints);
        },
        timeout: function(data) {
            $(".overlay").hide();
            $("#timeout")
                .show()
                .find("#close").click(function() {
                    port.disconnect();
                });
        }
    };

    var displayMsg = function(msg, own, encrypted) {
        var $row = $('<div class="row"></div>');

        if (!own) {
            $('<img class="profilePhoto"></img>')
                .attr("src", profilePhoto)
                .appendTo($row);
        }

        var $msg = $('<div class="message"></div>')
            .text(msg);
        if (own) $msg.addClass("own");
        if (encrypted) $msg.addClass("encrypted");
        $msg.appendTo($row);

        $("#messages")
            .append($row)
            .scrollTop($("#messages").prop("scrollHeight"));

        return $msg;
    };

    console.log("iframe online between", ownId, " and ", id);

    for (var i = 0; i < oldMessages.length; i++) {
        displayMsg(oldMessages[i].msg, oldMessages[i].own, false);
    }

    // TODO share makeName from shared.js (these ids are already escaped for "-" anyway, though)
    // this will alert event.js that we're ready to receive messages, triggering connectTab
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
        if (data.type === 'status') {
            handleStatus[data.status](data);
        } else if (data.type === 'recv') {
            displayMsg(data.msg, false, data.encrypted);
        } else if (data.type === 'recvOwn') {
            displayMsg(data.msg, true, true); // all messages sent from safechat are encrypted
        }
    });
});
