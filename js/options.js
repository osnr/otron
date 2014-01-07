var appendKeyView = function(el, name, fingerprint, key, remove) {
    var $view = $('.fingerprint-view-template')
            .clone()
            .removeClass('fingerprint-view-template');

    if (name && name.length > 0) {
        $view
            .find('.fingerprint-name').text(name).end()
            .find('.fingerprint').text(fingerprint).end();
    } else {
        $view.find('dl').remove().end();
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

    return $view
        .find('.show-key')
            .click(function() {
                launchKeyModal(name, key);
            }).end()
        .appendTo(el)
        .show();
};

var launchKeyModal = function(name, key) {
    var modal = $('.overlay').clone();
    $(modal).removeAttr('style');
    $(modal).find('button, .close-button').click(function() {
        $(modal).addClass('transparent');
        setTimeout(function() {
            $(modal).remove();
        }, 1000);
    });

    $(modal).click(function() {
        $(modal).find('.page').addClass('pulse');
        $(modal).find('.page').on('webkitAnimationEnd', function() {
            $(this).removeClass('pulse');
        });
    });
    $(modal).find('.page').click(function(ev) {
        ev.stopPropagation();
    });

    $(modal).find('.page h1').text(name);
    $(modal).find('.content-area').text(key);

    $('body').append(modal);
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

    chrome.storage.local.get(null, function(data) {
        var names = {};
        for (var k in data) {
            if (!data.hasOwnProperty(k)) continue;

            var kPieces = k.split('-');
            if (k === 'privKey') {
                var privKey = DSA.parsePrivate(data[k]);
                appendKeyView($('#own-public-key'),
                              false,
                              privKey.fingerprint(),
                              privKey.packPublic(),
                              false);

            } else if (kPieces.length === 2 && kPieces[0] === 'name') {
                var id = kPieces[1];
                names[id] = data[k];

            } else if (kPieces.length === 2 && kPieces[0] === 'keyInfo') {
                var id = kPieces[1];
                var keyInfo = data[k];

                appendKeyView($('#key-list'),
                              names[id],
                              keyInfo.fingerprint,
                              keyInfo.pubKey,
                              function remove() {
                                  chrome.storage.local.remove(k);
                              });
            }
        }
    });
    appendKeyView($('#own-public-key'), 'Omar Rizwan', 'hello', 'hello1', function() {});
});
