var makeName = function(pieces) {
    return pieces.map(function(x) { return String(x).replace(/-/g, ""); }).join("-");
};

var unsafePortName = function(ownId, id) {
    return makeName(["unsafePort", ownId, id]);
};
