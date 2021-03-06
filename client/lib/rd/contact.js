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

dojo.provide("rd.contact");

dojo.require("dojo.DeferredList");

dojo.require("couch");
dojo.require("rd.store");
dojo.require("rd._api");
dojo.require("rd.api");

//Derives from rd._api
rd.contact = dojo.delegate(rd._api);

dojo.mixin(rd.contact, {
  //Storage by contactId
  _store: [],
  _byContact: {},
  _byIdty: {},
  _idtyMapIds: {},
  _listStatus: "unfetched",
  _matches: {},

  matches: function(/*String*/name, /*Function*/callback, /*Function?*/errback) {
    //summary: Returns a list of possible contact matches to the callback.

    //Use cache when possible.
    if (name in this._matches) {
      callback(this._matches[name]);
      return;
    }

    this.list(dojo.hitch(this, function(contacts) {
      var matches = [];
      var matchIds = {};

      //Take off @ domain from an email, then separate names in original
      //name by whitespace.
      sourceNames = name.split("@")[0].toLowerCase();
      var sourceNames = sourceNames.split(/\s+/);

      //Cycle through the names to try and find a match.
      //TODO: This is a bit expensive. Ideally this could become a back-end extension,
      //although there are "fresher" results if this is run at display-time.
      //May not be worth the cost though, back-end extension might be better.
      for (var k = 0, from; from = sourceNames[k]; k++) {
        for (var i = 0, contact; contact = contacts[i]; i++) {
          //See if contact name matches
          var names = contact.name.split(/\s+/);
          var contactId = contact.rd_key[1];
          if (this._hasNameMatch(from, names)) {
            if (!matchIds[contactId]) {
              matches.push(contact);
              matchIds[contactId] = 1;
            }
            continue;
          }

          //Check each identity for a match.
          for (var j = 0, identity; identity = contact.identities[j]; j++) {
            names = identity.name.split(/\s+/);
            names.unshift(identity.nickname);
            if (this._hasNameMatch(from, names)) {
              if (!matchIds[contactId]) {
                matches.push(contact);
                matchIds[contactId] = 1;
              }
              break;
            }
          }
        }
      }
      this._matches[name] = matches;
      callback(matches);
    }), errback);
    
    return; //For strict JS checking.
  },

  list: function(/*Function*/callback, /*Function?*/errback) {
    //summary: returns a list of all contacts with their identities loaded.
    if (this._listStatus == "done") {
      callback(this._store);
    } else {
      this._loaded = false;
      this._listStatus = "needFetch";
      this.list.apply(this, arguments);
    }
  },

  get: function(/*String|Array*/contactId, /*Function*/callback, /*Function?*/errback) {
    //summary: gets a contact with its associated identities attached. Either one
    //contactId can be passed or an array of contactId strings.
    var contact = this._store[contactId];
    var isSingle = (typeof contactId == "string");

    var contacts = this._get(contactId);

    if (!contacts.unknown) {
      if (!contacts.missing) {
        callback(isSingle ? contacts.found[0] : contacts.found);
      } else {
        this._loadIdtys(contacts.missing, function(found) {
          if (contacts.found) {
            found = contacts.found.concat(found);
          }
          callback(isSingle ? found[0] : found);
        }, errback);
      }
    } else {
      errback && errback(new Error("unknown identity: " + contacts.unknown));
    }
  },

  byIdentity: function(/*Array*/identityId, /*Function*/callback, /*Function?*/errback) {
    //summary: fetches a contact via the identity. Just one identityId
    //can be passed, or multiple identitIds as an array can be passed.
    //Since an identity can be tied to more than one contact, the callback may receive
    //an array of contacts instead of just one contact, so the list
    //of contacts received may be of different length than the identityIds
    //passed to this function.
    if (typeof identityId[0] == "string") {
      identityId = [identityId];
    }

    var contactIds = [];
    for (var i = 0, iId; iId = identityId[i]; i++) {
      contactIds.push.apply(contactIds, this._byIdty[iId.join("|")]);
    }

    this.get(contactIds, callback, errback);
  },

  addIdentity: function(/*Object*/contact, /*Object*/identity,
                        /*Function*/callback, /*Function?*/errback) {
    //summary: adds the given identity to a contact specified by contact
    //by creating a raindrop document that connects the contact to the identity.
    //This method create the contact document if it does not exist, and also create
    //a rd.identity.contacts reo
    //SHOULD NOT be used if identity existed before, and already has an
    //rd.identity.contacts record. Use merge() for that case.
    // contact:
    //    an object that has either a contactId or name property. If no
    //    contactId, then it is assumed a new contact needs to be created
    //    with the given name property.
    if (contact.contactId) {
      this._makeRdIdentityContacts(identity, contact.contactId, callback, errback);
    } else if (contact.name) {
      //Create the contact record first.Dynamically load the uuid stuff we need
      //for the contacts.
      dojo["require"]("dojox.uuid.generateRandomUuid");
      dojo["require"]("dojox.uuid.Uuid");
      dojo.addOnLoad(dojo.hitch(this, function(){
        var uuid = dojox.uuid;
        uuid.Uuid.setGenerator(uuid.generateRandomUuid);
        var uid = (new uuid.Uuid()).toString();

        var contactDoc = {
          name: contact.name,
          rd_key:["contact", uid],
          rd_schema_id: "rd.contact",
          rd_source: [identity._id]
        }

        //Insert the document.
        rd.store.put(contactDoc, dojo.hitch(this, function(contact) {
          //Update our cache
          this._store.push(contact);
          this._store[uid] = contact;
          //Finish with creating the rd.identity.contacts record.
          this._makeRdIdentityContacts(identity, uid, callback, errback);
        }), errback);
      }));
    } else if (errback) {
      errback("Invalid contact object passed to rd.contact.addIdentity");
    }
  },

  merge: function(/*String*/sourceContactId, /*String*/targetContactId,
                  /*Function*/callback, /*Function?*/errback) {
    //summary: merges two contacts by figuring out which one has the fewer
    //number of identities, then changing the identity maps for those identities
    //to point to the other contact. Then deletes the old contact record.
    var source = this._store[sourceContactId];
    var target = this._store[targetContactId];

    if (target.identities.length < source.identities.length) {
      var temp = source;
      source = target;
      target = temp;
    }

    //For each identity in source, grab the identity/contact map document
    //and update it to point to the new contactId.
    //TODO: this is really unsafe: just doing a bunch of doc updates
    //and then a contact delete. Need to account for errors better and
    //try to do rollbacks?
    var dfds = [];
    for (var i = 0, idty; idty = source.identities[i]; i++) {
      var idtyMapDocId = this._idtyMapIds[idty.rd_key[1].join("|")];
      //TODO: is this broken? does the dfd only ever point to the last
      //dfd created?
      var dfd = new dojo.Deferred();
      couch.db("raindrop").openDoc(idtyMapDocId, {
        success: dojo.hitch(this, function(dfd, json) {
          //Update the contact ID field with the new field.
          var contacts = json.contacts;
          for (var i = 0; i < contacts.length; i++) {
            if (contacts[i][0] == source.rd_key[1]) {
              contacts[i][0] = target.rd_key[1];
              break;
            }
          }

          //Now save the change to the couch.
          couch.db("raindrop").saveDoc(json, {
            success: function(json) {
              dfd.callback(json);
              return json;
            },
            error: function(response) {
              dfd.errback(response);
              return response;
            }
          });
        }, dfd),
        error: errback
      });

      dfds.push(dfd);
    }

    //Now wait for all the contacts to be updated via a DeferredList.
    var dfdList = new dojo.DeferredList(dfds);
    dfdList.addCallback(dojo.hitch(this, function(response) {
      //The data we have is not incomplete.  Force a refresh of the
      //data. TODO: make this smarter? Just update in memory cache?
      this._reset();
      return response;
    }));
    dfdList.addCallbacks(callback, errback);

    //TODO: delete the old contact?
  },

  _get: function(/*String|Array*/contactId) {
    //summary: private method that figures out what contacts are already
    //loaded with identities and which ones are missing identities.
    //contactId can be one ID or an array of IDs.
    var missing = [], found = [], unknown = [];
    if (typeof contactId == "string") {
      contactId = [contactId];
    }
    
    for (var i = 0, id; id = contactId[i]; i++) {
      var temp = this._store[contactId];
      temp && temp.identities ? found.push(temp) : missing.push(id);
    }

    return {
      found: found.length ? found : null,
      missing: missing.length ? missing: null,
      unknown: unknown.length ? unknown: null
    }
  },

  _reset: function() {
    //summary: clears the in memory cache and sets up a trigger
    //of data on next public operation.
    this._store = [];
    this._byContact = {};
    this._byIdty = {};
    this._idtyMapIds = {};
    this._listStatus = "unfetched";

    this._loaded = false;    
  },

  _load: function() {
    //summary: rd._api trigger for loading api data.
    if(this._store.length) {
      //Already retrieved the contacts and identity/contact mappings.
      //Just need to make sure we do not need to load all identities.
      if (this._listStatus == "needFetch") {
        this._fetchAllIdentities();
      } else {
        this._onload();
      }
    } else {
      // open all contacts - note this also includes contacts without
      // associated identities...
      rd.store.megaview({
        key: ["rd.core.content", "schema_id", "rd.contact"],
        include_docs: true,
        reduce: false,
        success: dojo.hitch(this, function(json) {
          //Error out if no rows return.
          if(!json.rows.length) {
            this._error = new Error("no contacts");
            this._onload();
          } else {
            for (var i = 0, row, doc; (row = json.rows[i]) && (doc = row.doc); i++) {
              this._store.push(doc);
              // for contacts, rd_key is a tuple of ['contact', contact_id]
              this._store[doc.rd_key[1]] = doc;
            }
  
            this._loadIdtyMapping();
          }
        }),
        error: dojo.hitch(this, function(err) {
          this._error = err;
          this._onload();
        })      
      });
    }
  },

  _loadIdtyMapping: function() {
    //summary: loads the contact-identity mapping.

    rd.store.megaview({
      startkey: ["rd.identity.contacts", "contacts"],
      endkey: ["rd.identity.contacts", "contacts", {}],
      reduce: false,
      success: dojo.hitch(this, function(json) {
        //Error out if no rows return.
        if(!json.rows.length) {
          this._error = new Error("no contacts");
          this._onload();
        } else {
          for (var i = 0, row; row = json.rows[i]; i++) {
            // check we really have an identity record...
            this._mapIdtyToContact(row.value, row.key[2][0]);
          }

          if (this._listStatus == "needFetch") {
            this._fetchAllIdentities();
          } else {
            this._onload();
          }
        }
      }),
      error: dojo.hitch(this, function(err) {
        this._error = err;
        this._onload();
      })
    });
  },

  _mapIdtyToContact: function(/*Object*/idtyMapDoc, /*String*/contactId) {
    //summary: given a new identity, map it correctly to the contact in internal storage

    rdkey = idtyMapDoc.rd_key;
    var idid = rdkey[1];
    var idtyStringKey = idid.join("|");
  
    //Hold onto the document ID for this identity map,
    //for use in updating/merging identity/contact relationships
    this._idtyMapIds[idtyStringKey] = idtyMapDoc._id;
  
    //Store identities by contactId
    var byContact = this._byContact[contactId];
    if (!byContact) {
      byContact = this._byContact[contactId] = [];
    }
    byContact.push(idid);

    //Then store the contact by identity.
    var byIdty = this._byIdty[idtyStringKey];
    if (!byIdty) {
      byIdty = this._byIdty[idtyStringKey] = [];
    }
    byIdty.push(contactId);
  },

  _loadIdtys: function(/*String|Array*/contactId, /*Function*/callback, /*Function?*/errback){
    //Loads all the identities for a set of contacts.

    //Normalize input to an array.
    if (typeof contactId == "string") {
      contactId = [contactId];
    }

    //Gather the identities we need to fetch, based
    //on the contact-to-identity mapping.
    var identityIds = [];
    for(var i = 0, id; id = contactId[i]; i++) {
      var idtyIds = this._byContact[id];
      if (idtyIds && idtyIds.length) {
        identityIds.push.apply(identityIds, idtyIds);
      }
    }

    //Get identities.
    rd.api().identity({
      ids: identityIds
    })
    .ok(this, function(foundIdtys) {
      //Normalize input.
      if (typeof foundItys == "string") {
        foundIdtys = [foundIdtys];
      }

      for (var i = 0, idty; idty = foundIdtys[i]; i++) {
        this._attachIdentity(idty);
      }

      //Now collect the contacts originally requested and do the callback.
      var ret = [];
      for (var i = 0, cId; cId = contactId[i]; i++) {
        ret.push(this._store[cId]);
      }
      callback(ret);
    })
    .error(errback);
  },
  
  _attachIdentity: function(/*Object*/idty) {
    //summary: given an identity, attach it to the cache of the contact in the data store.
    //Use the first part of the identity as a property on the contact. This means for
    //instance, only one twitter account will be on the contact at
    //contact.twitter, but all identities are listed in contact.identities.
    console.assert(idty.rd_key[0]=='identity', idty) // not an identity?
    idid = idty.rd_key[1];
    var cIds = this._byIdty[idid.join("|")];
    if (cIds && cIds.length) {
      for (var j = 0, cId; cId = cIds[j]; j++) {
        var contact = this._store[cId];
        var idType = idid[0];

        //Only keep one property on the object
        //with the idType, so that means first one
        //in the list wins for that type of identity.
        if (!contact[idType]) {
          contact[idType] = idty;
        }

        if (!contact.identities) {
          contact.identities = [];
        }

        //Make sure we do not add the same contact more than once.
        if(dojo.indexOf(contact.identities, idty) == -1) {
          contact.identities.push(idty);
          
          //If the contact does not have an image, use one
          //on the identity if possible. First one with a picture wins.
          if(idty.image && !contact.image) {
            contact.image = idty.image;
          }
        }
      }
    }
  },

  _fetchAllIdentities: function() {
    //summary: fetches all the identities for all the contacts. Normally
    //a response to a rd.contact.list() call.

    //Get the list of contactIds that still need to be fetched.
    var contactIds = [];
    for (var i = 0, contact; contact = this._store[i]; i++) {
      if (!contact.identities) {
        contactIds.push(contact.rd_key[1]);
      }
    }
    if(!contactIds.length) {
      this._listStatus = "done";
      this._onload();
    } else {
      //Load the identities.
      this._loadIdtys(
        contactIds,
        dojo.hitch(this, function(contacts) {
          this._listStatus = "done";
          this._onload();
        }),
        dojo.hitch(this, function(err) {
            this._error = err;
            this._onload();
        })
      );
    }
  },

  _makeRdIdentityContacts: function(/*Object*/identity, /*String*/contactId,
                                    /*Function*/callback, /*Function?*/errback) {
    //summary: just makes an rd.identity.contacts record.

    //Generate the new rd.identity.contacts document.
    var idtyMap = {
      rd_key: identity.rd_key,
      rd_schema_id: "rd.identity.contacts",
      rd_source: [identity._id],
      rd_megaview_expandable: ["contacts"], 
      contacts: [
        [contactId, null]
      ]
    };

    //Insert the document.
    rd.store.put(idtyMap, dojo.hitch(this, function() {
      //Update the data store.
      this._mapIdtyToContact(idtyMap, contactId);
      this._attachIdentity(identity);

      callback();
      rd.pub("rd-contact-updated", this._store[contactId]);
    }), errback);
  },

  _hasNameMatch: function(/*String*/from, /*Array*/names) {
    //summary: sees if there is a match in names with from, and vice versa. Basically,
    //if any name matches with part of from or from matches with a part of a name.
    var ret = false;
    //Do not bother with short one letter names.
    if (from.length > 1) {
      for (var i = 0, name; name = names[i]; i++) {
        name = name.toLowerCase();
        if (name.length > 1 && (from.indexOf(name) != -1 || name.indexOf(from) != -1)) {
          return true;
        }
      }
    }
    return ret;
  }
});

rd.contact._protectPublic();
