"use strict";

var appendKeyView = function(el, name, fingerprint, trust, remove) {
    fingerprint = fingerprint.match(/(.{1,8})/g).join(' ');

    var $view = $('.fingerprint-view-template')
            .clone()
            .removeClass('fingerprint-view-template');

    if (name && name.length > 0) {
        $view
            .find('.fingerprint-name').text(name).end()
            .find('.fingerprint').text(fingerprint).end();
    } else {
        $view.find('dl').remove();
        $('<div class="fingerprint text"></div>')
            .text(fingerprint)
            .prependTo($view);
    }

    if (remove) {
        $view.find('.remove-key')
            .click(function() {
                remove();
                $view.slideUp(function() { $view.remove(); });
            }).appendTo($view);
    } else {
        $view.find('.remove-key').remove();
    }

    $view.css('display', '') // why not use show()? cause we don't want display: block
         .appendTo(el);
};

var loadData = function() {
    chrome.storage.local.get(null, function(data) {
        $('#own-public-key .fingerprint-view').remove();
        $('#key-list .fingerprint-view').remove();

        for (var k in data) {
            if (!data.hasOwnProperty(k)) continue;

            var kPieces = k.split('-');
            if (k === 'ownFingerprint') {
                var fingerprint = data[k];

                appendKeyView($('#own-public-key'),
                              '',
                              fingerprint,
                              false,
                              false);

            } else if (kPieces.length === 3 && kPieces[0] === 'knownFingerprints') {
                var ownId = kPieces[1], id = kPieces[2];
                var nameKey = makeName(["name", ownId, id]);
                var name = data[nameKey];
                var knownFingerprints = data[k];

                for (var i = 0; i < knownFingerprints.length; i++) {
                    (function(k, i) {
                        appendKeyView($('#key-list'),
                                      name,
                                      knownFingerprints[i].fingerprint,
                                      knownFingerprints[i].trust,
                                      function remove() {
                                          knownFingerprints.splice(i, 1);

                                          if (knownFingerprints.length > 0) {
                                              storageSet(k, knownFingerprints);
                                          } else {
                                              // forget the whole conversation!
                                              chrome.storage.local.remove([
                                                  nameKey, // name
                                                  k, // knownFingerprints
                                                  makeName(["chatEncrypt", ownId, id])
                                                  makeName(["instanceTag", ownId, id])
                                              ]);
                                          }
                                      });
                    })(k, i);
                }
            } else if (k === 'token') {
                var token = data[k];

                $('#security-token').attr('src', token);
            }
        }
    });
};

$(function() {
    $('.menu a').click(function(ev) {
        ev.preventDefault();
        var selected = 'selected';

        $('.mainview > *').removeClass(selected);
        $('.menu li').removeClass(selected);
        setTimeout(function() {
            $('.mainview > *:not(.selected)').css('display', 'none');
        }, 100);

        $(ev.currentTarget).parent().addClass(selected);
        var currentView = $($(ev.currentTarget).attr('href'));
        currentView.css('display', 'block');
        setTimeout(function() {
            currentView.addClass(selected);
        }, 0);

        setTimeout(function() {
            $('body')[0].scrollTop = 0;
        }, 200);
    });

    $('.mainview > *:not(.selected)').css('display', 'none');

    // warning: there's sort of a security risk here --
    // improper filtering could result in attacker triggering
    // 'regenerate', or 'forget key', just by accessing a URL
    $('.menu a').filter('[href="' + window.location.hash + '"]').click();

    loadData();

    chrome.storage.onChanged.addListener(function(changes, areaName) {
        // TODO more granular update
        loadData();
    });

    $('#regenerate-keys').click(function() {
        chrome.runtime.sendMessage({ type: 'regenKey' });
    });

    $('#regenerate-token').click(function() {
        chrome.runtime.sendMessage({ type: 'regenToken' });
    });
});
