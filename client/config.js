;(function(){
  //Find raindrop location
  var scripts = document.getElementsByTagName("script");
  var i = scripts.length - 1;
  var prefix = "";
  while(i > -1){
    var src = scripts[i].src;
    if(src && src.indexOf("/raindrop/files/config") != -1){
      prefix = src.split("/").slice(0, 3).join("/") + "/raindrop/files";
    }
    i--;
  }

  djConfig = {
    debugAtAllCosts: true, //comment  this out for faster loading.
    require: ["rd", "couch", "dojo.parser" /*"dojox.io.proxy.xip"*/],
    parseOnLoad: true,
    baseUrl: "./",
    couchUrl: prefix.split("/", 3).join("/"),
    //iframeProxyUrl: "http://127.0.0.1:5984/raindrop/files/xip_server.html",

    //If we only support postMessage browsers, then don't need client URL
    //This makes the assumption the app always includes xip_client.html in the
    //same directory as any app page that uses the couchdb API.
    xipClientUrl: "./xip_client.html",
    modulePaths: {
      /*INSERT CONFIG HERE*/
      //"dojox.io.proxy.xip": prefix + "/xip",
      "rd": prefix + "/rd",
      "couch": prefix + "/couch",
      "rdw": prefix  + "/rdw"
    },
    
    scopeMap: [
      ["dojo", "rd"],
      ["dijit", "rdw"],
      ["dojox", "rdx"]
    ]
  };
  
  //TODO: just doing this here in JS because my python fu is weak.
  //Need to split off the html file name from the application paths.
  //Also need to strip off domain if it matches the page we are currently
  //on, to avoid xd loading of modules (makes for easier debugging). That
  //part might need to be kept in JavaScript. Using http headers on the server
  //will not give us the full picture.
  var parts = location.href.split("/");
  var frameworkNames = {
    "rd": 1,
    "couch": 1,
    //"dojox.io.proxy.xip": 1
  };
  
  for (var param in djConfig.modulePaths) {
    var value = djConfig.modulePaths[param];
    
    //Pull off . files from path
    value = value.split("/");
    if (value[value.length - 1].indexOf(".") != -1) {
      value.pop();
    }

    //Adjust path to be local, if not one of the framework values.
    if (!frameworkNames[param]) {
        if (value[0] == parts[0] && value[1] == parts[1] && value[2] == parts[2]){
          value.splice(0, 3, "");
        }
    }

    value = value.join("/");
    djConfig.modulePaths[param] = value;
  }
  
  document.write('<script src="http://ajax.googleapis.com/ajax/libs/dojo/1.3.0/dojo/dojo.xd.js.uncompressed.js"></script>');
})();