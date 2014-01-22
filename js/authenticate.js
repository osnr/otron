"use strict";

// from https://stackoverflow.com/questions/13949059/persisting-the-changes-of-range-objects-after-selection-in-html/13950376#13950376
var saveSelection = function(containerEl) {
    var range = window.getSelection().getRangeAt(0);
    var preSelectionRange = range.cloneRange();
    preSelectionRange.selectNodeContents(containerEl);
    preSelectionRange.setEnd(range.startContainer, range.startOffset);
    var start = preSelectionRange.toString().length;

    return {
        start: start,
        end: start + range.toString().length
    };
};
var restoreSelection = function(containerEl, savedSel) {
    var charIndex = 0, range = document.createRange();
    range.setStart(containerEl, 0);
    range.collapse(true);
    var nodeStack = [containerEl], node, foundStart = false, stop = false;

    while (!stop && (node = nodeStack.pop())) {
        if (node.nodeType == 3) {
            var nextCharIndex = charIndex + node.length;
            if (!foundStart && savedSel.start >= charIndex && savedSel.start <= nextCharIndex) {
                range.setStart(node, savedSel.start - charIndex);
                foundStart = true;
            }
            if (foundStart && savedSel.end >= charIndex && savedSel.end <= nextCharIndex) {
                range.setEnd(node, savedSel.end - charIndex);
                stop = true;
            }
            charIndex = nextCharIndex;
        } else {
            var i = node.childNodes.length;
            while (i--) {
                nodeStack.push(node.childNodes[i]);
            }
        }
    }

    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
};

(function() {
    var fingerprint;
    var port;

    var onInitAuthenticate = function(data) {
        if (data.type !== 'initAuthenticate') return;
        chrome.runtime.onMessage.removeListener(onInitAuthenticate);

        fingerprint = data.fingerprint;

        $(document).ready(function() {
            console.log(data);

            port = chrome.runtime.connect({
                name: makeName(["authenticate", data.ownId, data.id, data.fingerprint])
            });
            port.onMessage.addListener(onMessage);

            var nameKey = makeName(["name", data.ownId, data.id]);
            chrome.storage.local.get(["token", nameKey], function(items) {
                if (!("token" in items)) return;
                $("#page-token").attr("src", items["token"].image);

                if (!(nameKey in items)) return;
                var name = items[nameKey];

                document.title = name + " - OTRon identity authentication";
                $(".friend-name").text(name);
            });

            $(".screen").hide();
            if (data.mode === 'fingerprint' || data.mode === 'both') {
                $(".own-fingerprint").text(
                    data.ownFingerprint.match(/(.{1,8})/g).join(' '));
            }

            if (!data.mode || data.mode === 'both') {
                $("#start-fingerprint").click(startFingerprintAuth);
                $("#start-smp").click(startSmpAuth);

                $("#start").show();

            } else if (data.mode === 'smp') {
                startSmpResponseAuth(data.question);

            } else if (data.mode === 'fingerprint') {
                startFingerprintAuth();
            }
        });
    };
    chrome.runtime.onMessage.addListener(onInitAuthenticate);

    var onMessage = function(data) {
        console.log("msg", data);

        $(".screen").hide();
        if (data.type === 'fingerprintTrust') {
            $("#trust-fingerprint").show();

        } else if (data.type === 'smpInit') {
            $("#init-smp").show();

        } else if (data.type === 'smpTrust') {
            $("#trust-smp").show();

        } else if (data.type === 'smpFail') {
            if (data.action === 'asked') {
                $("#fail-smp").show();
            } else if (data.action === 'answered') {
                $("#fail-smp-response").show();
            }

        } else if (data.type === 'smpAbort') {
            $("#abort-smp").show();

        } else if (data.type === 'smpResponseInit') {
            $("#init-smp").show();
        }
    };

    var startFingerprintAuth = function() {
        $(".screen").hide();

        $("#auth-fingerprint").show();

        $("#chat-fingerprint").keyup(function(event) {
            var text = $(this).text();
            var sel = saveSelection(this);

            $(this).empty();

            var subtext, cleanSubtext;
            for (var len = text.length; len >= 0; len -= 1) {
                subtext = text.substring(0, len);
                cleanSubtext = subtext.replace(/\s/g, '');

                if (cleanSubtext === fingerprint.substring(0, cleanSubtext.length)) {
                    // ah, it matches
                    $('<span class="correct"></span>')
                        .text(subtext)
                        .appendTo(this);

                    break;
                }
            }

            var remnant = text.substring(len);
            if (remnant.length > 0) {
                $('<span class="incorrect"></span>')
                    .text(remnant)
                    .appendTo(this);
            }

            restoreSelection(this, sel);

            if (cleanSubtext === fingerprint) {
                // we are ready to submit
                $("#submit-fingerprint").prop("disabled", false);
            } else {
                $("#submit-fingerprint").prop("disabled", true);
            }
        });

        $("#submit-fingerprint").click(function() {
            // we don't actually need to submit anything,
            // this just locks in "verified status"
            port.postMessage({ type: 'authFingerprint' });
        });
    };

    var startSmpAuth = function() {
        $(".screen").hide();

        $("#auth-smp").show();

        $("#submit-smp").click(function() {
            // TODO clean prompt (better null than "")
            port.postMessage({
                type: 'authSmp',
                prompt: $("#prompt").val(),
                secret: $("#secret").val()
            });
        });
    };

    var startSmpResponseAuth = function(question) {
        $(".screen").hide();

        $("#auth-smp-response").show();

        $("#response-prompt-prompt").text(question);
        $("#submit-smp-response").click(function() {
            port.postMessage({
                type: 'authSmpResponse',
                secret: $("#response-secret").val()
            });
        });
    };
})();
