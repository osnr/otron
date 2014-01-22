"use strict";

$(document).ready(function() {
    var mode = window.location.search.substr(1);
    $("." + mode).show();
    $("#generating").show();

    chrome.runtime.sendMessage({ type: 'loaded' });

    chrome.runtime.onMessage.addListener(function(data) {
        if (data.type !== 'doneGen') return;
        console.log(data);

        $("#generating").hide();
        $("#done").show();

        if (mode === 'genKey' || mode === 'genBoth') {
            $(".fingerprint").text(
                data.fingerprint.match(/(.{1,8})/g).join(' '));
        }

        if (mode === 'genToken' || mode === 'genBoth') {
            $("#token-image").attr("src", data.token.image);
            $("#token-color").css("background-color", "rgba(" + data.token.color.join(",") + ")");
        }
    });

    $('.learn-more').click(function() {
        window.close();
    });
});
