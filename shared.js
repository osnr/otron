var makeName = function(pieces) {
    return pieces.map(function(x) { return String(x).replace(/-/g, ""); }).join("-");
};

var privKeyKey = function(ownId) {
    return makeName(["priv", "key", ownId]);
};

var unsafePortName = function(ownId, id) {
    return makeName(["unsafe", "port", ownId, id]);
};
