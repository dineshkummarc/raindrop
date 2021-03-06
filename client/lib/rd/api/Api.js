/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Raindrop.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Messaging, Inc..
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 * */

dojo.provide("rd.api.Api");

//First add some sugar to rd.api. This is a bit unusual, since this would
//be normally done in rd.api itself, but because of the loading order --
//rd.api requires dojo.api.* modules that will call dojo.api.extend before the
//rd.api module is evaluated -- the work happens in here.

/**
 * Creates a chainable API call object.
 * 
 * @param args {Object} the arguments to configure the API calls. This argument
 * may be modified by this call.
 * @param args.dbPath {String} The URL of the CouchDB database to use.
 * @returns {rd.api.Api}
 */
rd.api = function(args) {
  return new rd.api.Api(args);
}

dojo._mixin(rd.api, {
  /**
   * Adds new methods to the set of chainable operations.
   * Usually called via rd.api.fn.extend();
   * 
   * @param extensions {Object} an object argument whose properties are
   * used as new prototype methods on rd.api.Api, and the values should
   * be functions that "return this" to keep the chain alive.
   *
   * @returns {rd.api}
   */
  extend: function(extensions) {
    //For each extension, create a new instance of the rd.api.Api, so each
    //method gets its own Deferred to operate on.
    
    var empty = {};
    for (var prop in extensions) {
      rd.api._autoChain(prop, extensions[prop]);
    }
    //Allow this method to be attached to rd.api.Api or to be called directly
    //from rd.api.
    return this instanceof rd.api.Api ? this : rd.api;
  },

  /**
   * Adds a new chainable method to the rd.api() structure.
   * Assumes that if args.ids exist, the underlying function should be
   * called immediately, otherwise, it will wait for ids to be passed to
   * it via the previous chain call.
   *
   * @param {String} chainName the name of the method to add to rd.api()
   *
   * @param {Object} obj that contains the private method doing the work.
   *
   * @param {String} funcName the function on obj that does the real work.
   */
  addMethod: function(chainName, obj, funcName) {
    var o = {};
    o[chainName] = function(args) {
      if (args && args.ids) {
        obj[funcName](this._deferred, args, args.ids);
      } else {
        this.addParentCallback(dojo.hitch(obj, funcName, this._deferred, args));
      }
      return this;
    };

    rd.api.extend(o);
  },


  /**
   * Constructs a function that automatically creates a new rd.api.Api
   * object for use in the method, to allow Deferreds to be chained together.
   *
   * @param name {String} the name of the method to attach to the rd.api.Api
   * prototype.
   *
   * @param func {Function} the function for the name. 
   */
  _autoChain: function(name, func) {
    rd.api.Api.prototype[name] = function() {
      //Create new Api object.
      var api = new rd.api.Api(this.args, this);

      //Attach the name of this function to the api object, so
      //that the next link in the chain can query it to know what
      //kind of output it has.
      api._name = name;

      //Call the function.
      return func.apply(api, arguments);
    }
  }
});

/**
 * Creates a new object that can be used for chainable API operations.
 * @constructor
 *
 * @param args {Object} the arguments to configure the API calls. This argument
 * may be modified by this object.
 * @param args.dbPath {String} The URL of the CouchDB database to use.
 *
 * @param parent {rd.api.Api} a parent Api object that is used for building a chain.
 */
rd.api.Api = function(args, parent) {
  this.args = args || {};
  if (!this.args.dbPath) {
    this.args.dbPath = rd.dbPath || "/raindrop/";
  }
  
  this._parent = parent;
  this._deferred = new dojo.Deferred();
}

rd.api.Api.prototype = {
  /**
   * @private
   * list of properties that couchdb will accept as HTTP parameters.
   */
  _couchDbSafeProps: {
    "key": 1,
    "keys": 1,
    "startkey": 1,
    "startkey_docid": 1,
    "endkey": 1,
    "endkey_docid": 1,
    "limit": 1,
    "stale": 1,
    "descending": 1,
    "skip": 1,
    "group": 1,
    "group_level": 1,
    "reduce": 1,
    "include_docs": 1,
    "docs": 1
  },

  /**
   * Does an XHR call using the dojo facilities, then registers current
   * Deferred to that action.
   *
   * @param args {Object} the args to pass to XHR call. This method will
   * pull out the CouchDB-safe parameters and use that for a "content" arg
   * as part of args.
   */
  xhr: function(args) {
    //Make a delegate so we do not have to modify incoming args.
    var xhrArgs = dojo.delegate(args);

    //Pull out CouchDB-safe parameters.
    var content = args.content || {}, empty = {};
    for (var prop in args) {
      if (!(prop in empty) && prop in this._couchDbSafeProps) {
        var value = args[prop];
        //Couch likes array and object values as json data
        if (dojo.isArray(value) || dojo.isObject(value)) {
          value = dojo.toJson(value);
        }
        content[prop] = value;
      }
    }
    xhrArgs.content = content;

    //Figure out the kind of DB method.
    var method = args.method;
    if (!method) {
      method = "GET";
      if (content.keys) {
        method = "POST";
        xhrArgs.postData = '{ "keys": ' + content.keys + '}';
        delete content.keys;

        //Couch seems to want the other params on the querystring. Seems like
        //it should be OK to send them all in the body, but no.
        xhrArgs.url = xhrArgs.url
                    + (xhrArgs.url.indexOf("?") == -1 ? "?" : "&")
                    + dojo.objectToQuery(content);
        xhrArgs.content = null;
      } else if (content.docs) {
        //Probably a bulk doc operation.
        method = "POST";
        xhrArgs.postData = '{ "docs": ' + content.docs + '}';
        delete content.docs;
      }
    }

    //Allow "ok" as as substitute for "load"
    if (typeof args.ok == "function" && !args.load) {
      xhrArgs.load = ok;
    }

    //Default to JSON handling of the response
    if (!args.handleAs) {
      xhrArgs.handleAs = "json";
    }

    //You make the call!
    var dfd = dojo.xhr(method, xhrArgs);
  
    //Bind result to triggering current Deferred.
    dfd.addCallback(this._deferred, "callback");
    dfd.addErrback(this._deferred, "errback");

    return this;
  },

  /**
   * Ends this api call and returns to parent API call.
   * @returns {rd.api.Api}
   */
  end: function() {
    return this._parent;
  },

  /**
   * register a callback when the API completes successfully.
   * @returns {rd.api.Api}
   */
  ok: function(cb, cbfn) {
     //Allow a dojo.Deferred to be passed in and do scaffolding
    //to call its callback.
    if (cb instanceof dojo.Deferred) {
      this._deferred.addCallback(function(res) {
        return cb.callback(res);
      });
    } else {
      this._deferred.addCallback(cb, cbfn);
    }
    return this;
  },

  /**
   * register a callback if the API call has an error.
   * @returns {rd.api.Api}
   */
  error: function(cb, cbfn) {
    //Allow a dojo.Deferred to be passed in and do scaffolding
    //to call its errback.
    if (cb instanceof dojo.Deferred) {
      this._deferred.addErrback(function(err) {
        return cb.errback(err);
      });
    } else {
      this._deferred.addErrback(cb, cbfn);
    }
    return this;
  },

  /**
   * returns the deferred used by the current API call.
   * @returns {dojo.Deferred}
   */
  deferred: function() {
    return this._deferred;
  },

  addParentCallback: function(cb, cbfn) {
    var parent = this._parent;
    if (parent) {
      parent._deferred.addCallback(cb, cbfn);
    } else {
      throw new Error("rd.api: no parent for addParentCallback call");
    }
  },

  addParentErrback: function(cb, cbfn) {
    var parent = this._parent;
    if (parent) {
      parent._deferred.addErrback(cb, cbfn);
    } else {
      throw new Error("rd.api: no parent for addParentErrback call");
    }
  },

  extend: rd.api.extend
};

rd.api.extend({
  /**
   * filters the results from the previous call. Basically
   * binds via ok() then assumes the result is an array
   * that can be filtered into another array by using the function
   * argument.
   *
   * @param {Function} func function that does the filtering. The
   * function should return the array member if it is desired in the
   * output that is passed to the next chained function. The function
   * will be called with three arguments (item, index, array)
   */
  filter: function(cb, cbfn) {
    //Change the _name for this link in the chain to
    //the parent value, so downstream links think it is
    //the parent type.
    this._name = this._parent._name;

    //Allow for cbfn to be a string.
    //Manually doing this work since the deferred calls do it,
    //but a deferred is not used at this point.
    if (typeof cbfn == "string") {
      cbfn = cb[cbfn];
    }

    //Wait for parent to complete then filter.
    this._parent.ok(this, function(ary) {
      var ret = dojo.filter(ary, (cbfn ? cbfn : cb), cb);
      this._deferred.callback(ret);
    });

    return this;
  },

  megaview: function(args) {
    args = dojo.delegate(args);
    args.url = this.args.dbPath || rd.dbPath || "/raindrop/";
    args.url += "_design/raindrop!content!all/_view/megaview";
    return this.xhr(args);
  },

  doc: function(args) {
    args = dojo.delegate(args);
    args.url = this.args.dbPath || rd.dbPath || "/raindrop/";
    args.url += args.id;
    return this.xhr(args);
  },

  /**
   * Does a bulk update of all the documents in docs.
   *
   * @param {Object} args options for the couchdb calls.
   * @param {Array} args.docs and array of documents to update.
   */
  bulkUpdate: function(args) {
    args = dojo.delegate(args);
    args.url = this.args.dbPath || rd.dbPath || "/raindrop/";
    args.url += "_bulk_docs";
    args.content = {
      docs: args.docs
    };
    return this.xhr(args);
  },

  /**
   * Does a bulk update of all the documents in docs.
   *
   * @param {Object} args options for the couchdb calls.
   * @param {Array} args.doc the document to delete.
   */
  deleteDoc: function(args) {
    args = dojo.delegate(args);
    args.url = this.args.dbPath || rd.dbPath || "/raindrop/";
    args.url += args.doc._id + "?rev=" + args.doc._rev;
    args.method = "DELETE";
    return this.xhr(args);
  },

  /**
   * puts a document in the raindrop data store.
   * If successful, callback is called with the doc as the only argument.
   * It will generate the _id and rd_ext_id on the document if it does
   * not exist. Warning: it modifies the args.doc object.
   *
   * @param {Object} args options for the couchdb calls.
   * @param {Object} args.doc the document to insert into the couch.
   */
  put: function(args) {
    var doc = this.newDoc(args.doc);

    var docUrl = rd.dbPath + doc._id;
    if (doc._rev) {
      docUrl += "?rev=" + doc._rev;
    }

    var xhrArgs = dojo.delegate(args);
    xhrArgs.url = docUrl;
    xhrArgs.method = "PUT";
    xhrArgs.putData = dojo.toJson(doc);

    this.xhr(xhrArgs).ok(function(response){
      //Update the rev number on the doc.
      if (response.rev) {
        doc._rev = response.rev;
      }
      //Use the modified doc as the deferred
      //response data.
      return doc;
    });

    return this;
  },

  /**
   * Sets up a new document for insertion.
   * It will generate the _id and rd_ext_id on the document if it does
   * not exist. Warning: it modifies the args.doc object.
   *
   * @param {Object} doc the document to insert into the couch. The doc
   * object is modified by this function.
   */
  newDoc: function(doc) {
    //Add generic UI extension ID if needed.
    if (!doc.rd_ext_id) {
      doc.rd_ext_id = rd.uiExtId;
    }

    //Generate the ID for the document, if needed.
    if (!doc._id) {
      doc._id = "rc!"
              + doc.rd_key[0]
              + "."
              + rd.toBase64(doc.rd_key[1])
              + "!"
              + doc.rd_ext_id
              + "!"
              + doc.rd_schema_id;
    }

    return doc;
  }
});
