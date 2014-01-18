var makeName = function(pieces) {
    return pieces.map(function(x) { return String(x).replace(/-/g, ""); }).join("-");
};

var unsafePortName = function(ownId, id) {
    return makeName(["unsafePort", ownId, id]);
};

var storageSet = function(k, v) {
    var obj = {};
    obj[k] = v;
    chrome.storage.local.set(obj);
};

function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
             .toString(16)
             .substring(1);
};

function guid() {
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
         s4() + '-' + s4() + s4() + s4();
}
