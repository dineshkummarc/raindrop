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

dojo.provide("rdw.contactDropDown");

dojo.require("rdw.ContactSelector");

rdw.contactDropDown = {
  open: function(/*DOMNode*/domNode, /*Object?*/controller, /*String?*/suggestedAddName, /*Array?*/preferredContacts) {
    //Opens an dropdown with a ContactSelector near the domNode, passing
    //the optional preferredContacts to ContactSelector.    
    if (this.domNode == domNode && this._isOpen == true) {
      return;
    }
    this.domNode = domNode;

    //Make sure ContactSelector is set up and updated.
    if (!this.selector) {
      this.selector = new rdw.ContactSelector({});
      //Use a set timeout so the current click does not destroy the popup.
      setTimeout(dojo.hitch(this, function(){
        this.clickHandle = dojo.connect(dojo.doc.documentElement, "onclick", this, "onDocClick");
      }), 10);
    }
    this.selector.controller = controller;
    this.selector.update(suggestedAddName, preferredContacts);

    //Show the ContactSelector.
    dijit.popup.open({
      popup: this.selector,
      around: this.domNode,
      onCancel: this._closed,
      onClose: this._closed,
      onExecute: this._closed
    });

    this._isOpen = true;
    this._justOpened = true;
  },

  close: function() {
    //summary: closes teh contact drop down.
    this._justOpened = false;
    dijit.popup.close(this.selector);
    this._closed();
  },

  onDocClick: function(/*Event*/evt) {
    //summary: handles document clicks to see if we should hide the contacts.
    //Check if the click happens inside the ContactSelector.
    if (this._justOpened || !this._isOpen) {
      this._justOpened = false;
      return;
    } else {
      dijit.popup.close(this.selector);
      this._closed();
    }
/*
    var hide = true;
    var node = evt.target;
    while (node) {
      if (node == this.selector.domNode) {
        hide = false;
        break;
      }
      node = node.parentNode;
    }
    if (hide) {
      dijit.popup.close(this.selector);
      this._closed();
    }
*/
  },

  _closed: function() {
    //summary: function for dijit.popup.open calls.
    //DO NOT USE "this" in here, not safe.
    rdw.contactDropDown.domNode = null;
    rdw.contactDropDown._isOpen = false;
    rdw.contactDropDown.selector.clear();
  }
}