"use strict";

var uuid = window.location.search.substr(1);

chrome.runtime.onMessage.addListener(function onInitAuthenticate(data) {
    if (data.type !== 'initAuthenticate' ||
        data.uuid !== 'uuid') return;
    chrome.runtime.onMessage.removeListener(onInitAuthenticate);

    var port = chrome.runtime.connect({ name: makeName(["authenticate", data.ownId, data.id]) });

    $("#own-fingerprint").text(data.ownFingerprint);

    $("#chat-fingerprint").on('input', function(event) {
        console.log($(this).text());
    });
});

