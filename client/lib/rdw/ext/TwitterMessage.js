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

dojo.provide("rdw.ext.TwitterMessage");

dojo.require("rdw.Message");
dojo.require("rd.hyperlink");

/*
  Treat the Twitter messages differently than Email
*/

rd.applyExtension("rdw.ext.TwitterMessage", "rdw.Message", {
  after: {
    postMixInProperties: function() {
      var body = this.messageBag['rd.msg.body'];
      if(body.from && body.from[0] == "twitter") {
        this.message = rd.hyperlink.addTwitterUsers(this.message);
        this.message = rd.hyperlink.addTwitterTags(this.message);
      }
    }
  }
});

rd.addStyle("rdw.ext.css.TwitterMessage");
