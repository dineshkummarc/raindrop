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

dojo.provide("rdw.Account");

dojo.require("rdw._Base");
dojo.require("rd.api");

dojo.declare("rdw.Account", [rdw._Base], {
  templateString: '<div class="rdwAccount" dojoAttachEvent="onclick: onClick"> \
                    <span class="name" dojoAttachPoint="nameNode"></span> \
                    <a class="logout" href="#">&mdash;logout</a> \
                    <a class="settings" href="#rd:account-settings">settings</a> \
                   </div>',

  postCreate: function() {
    //summary: dijit lifecycle method, after template is in the DOM.
    rd.api().me().ok(this, function(idtys) {
      var name = "";
      for (var i = 0, idty; idty = idtys[i]; i++) {
        if (i == 0) {
          name = idty.rd_key[1][1];
        }
        //First identity with a name wins until there is a contact
        //written for all identities.
        if (idty.name) {
          name = idty.name;
          break;
        }
      }
      rd.escapeHtml(name, this.nameNode);
    });
  },

  onClick: function(evt) {
    //summary: handles click events.
    
    //Do not want protocol links going out for this widget.
    var href = evt.target.href;
    if (href && (href = href.split("#")[1])) {
      if (href.indexOf("rd:") == 0) {
        rd.dispatchFragId(href);
        evt.preventDefault();
      }
    }
  }
});
