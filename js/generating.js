var getAverageColor = (function() { // from https://gist.github.com/snorpey/5990253
    var i;
    var len;
    var multiplicator = 20;
    var count;
    var rgba;
    
    function getAverageRGBA( image_data, resolution )
    {
	multiplicator = parseInt( resolution, 10 ) > 1 ? parseInt( resolution, 10 ) : 10;
	len = image_data.data.length;
	count = 0;
	rgba = [ 0, 0, 0, 0 ];
        
	for ( i = 0; i < len; i += multiplicator * 4 )
	{
	    rgba[0] = rgba[0] + image_data.data[i];
	    rgba[1] = rgba[1] + image_data.data[i + 1];
	    rgba[2] = rgba[2] + image_data.data[i + 2];
	    rgba[3] = rgba[3] + image_data.data[i + 3];
            
	    count++;
	}
        
	rgba[0] = ~~ ( rgba[0] / count );
	rgba[1] = ~~ ( rgba[1] / count );
	rgba[2] = ~~ ( rgba[2] / count );
	rgba[3] = ~~ ( rgba[3] / count );
        
	return rgba;
    }
    
    return getAverageRGBA;
})();

$(document).ready(function() {
    chrome.runtime.sendMessage({ type: 'loaded' });

    chrome.runtime.onMessage.addListener(function(data) {
        if (data.type !== 'generatedKey') return;

        $("#generating").hide();
        $("#done").show();

        var canvas = $("#token canvas")[0];
        new Identicon(canvas, data.tokenNum, 128);

        var ctx = canvas.getContext("2d");
        var cData = ctx.getImageData(0, 0, 128, 128);
        var color = getAverageColor(cData);
        color = "rgba(" + color.join(",") + ")";

        chrome.storage.local.set({
            tokens: {
                icon: canvas.toDataURL("image/png"),
                color: color
            }
        });

        $("#bg-color").css("background-color", color);
    });
});
