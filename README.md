OTRon
=====

**WARNING: Don't use this extension for anything important! It hasn't been properly audited. This is just an experiment. Please use battle-hardened, well-tested tools if you need security.**

OTRon is a Chrome extension for one-click, end-to-end Facebook Web chat encryption.

Normally, Facebook employees and anyone who can somehow compromise Facebook (hostile governments, personal enemies..) can read everything you've ever discussed with anyone in Facebook chat.

With OTRon, as long as your computers are secure, no one besides you and your friend should ever be able to read your conversation ("encryption").

Your messages become unreadable after your chat is over ("perfect forward secrecy"), so even if your computer is compromised later, earlier chats should be safe.

## Installation
It's not available on the Chrome Web Store yet. To install, clone this repository and [load the unpacked extension folder in Chrome](http://developer.chrome.com/extensions/getstarted.html#unpacked).

## More information
See the [Intro](doc/intro.md) page for more information on usage.

See the [Threat Model](doc/threat-model.md) page for information about security.

## Credits and license
OTRon uses Arlo Breault's [JavaScript OTR library](https://github.com/arlolra/otr) and dependencies, [identicon.js](https://github.com/hgwr/identicon), Bootstrap tooltips, and jQuery.

OTRon is licensed under the GNU GPL, version 3.
