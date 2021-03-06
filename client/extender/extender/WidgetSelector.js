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

dojo.provide("extender.WidgetSelector");

dojo.require("rdw._Base");
dojo.require("dojo.string");

dojo.require("extender.Editor");

//Uses script-added styles to allow loading on demand at the cost of a
//custom build that would load all styles at the beginning.
rd.addStyle("extender.css.WidgetSelector");

dojo.declare("extender.WidgetSelector", [rdw._Base], {
  templatePath: dojo.moduleUrl("extender.templates", "WidgetSelector.html"),

  postCreate: function() {
    //summary: dijit lifecycle method, after template is in the DOM.
    
    //Tell parent to load helper selector.
    opener.rd.require("extender.widgetSelectorHelper");
    var _self = this;
    opener.rd.addOnLoad(function() {
      opener.extender.widgetSelectorHelper.start(_self);
    });
  },

  select: function(/*String*/widgetName) {
    //summary: handles selection of widget. Called by widgetSelectorHelper.
    this.targetName = widgetName;
    rd.escapeHtml(this.targetName, this.widgetNameNode, "only");
  },

  destroy: function() {
    //summary: dijit lifecycle method.
    //Make sure parent window does not hold on to this widget instance.
    opener.extender.widgetSelectorHelper.stop();
    this.inherited("destroy", arguments);
  },

  onCreateClick: function(evt) {
    //summary: handles creating the basic extension.
    dojo.stopEvent(evt);
    
    if (!this.targetName) {
      this.feedback("Please select a widget in the other window.");
      return;
    }

    var extName = dojo.trim(this.nameNode.value);
    if (!extName) {
      this.feedback("Please enter a name for the extension");
      return;
    }

    //Make sure extName is valid.
    extName = extName.replace(/[^\w_]/g, "");

    opener.extender.widgetSelectorHelper.stop();

    //Load up the sample extension, replacing the names.
    var template = dojo.cache("extender.templates", "sampleObjectExtension.js");
    var text = dojo.string.substitute(template, {
      extName: extName,
      targetModule: this.targetName
    });

    //Show the editor widget.
    var editor = new extender.Editor({
      moduleName: "ext." + extName,
      targetNames: [this.targetName],
      content: text,
      extType: "ext"
    });

    this.extender.add(editor);

    //Trigger the extension immediately?
    editor.onSave();
    this.feedback("");
  },

  feedback: function(/*String*/message) {
    //summary: give user feedback on their action.
    rd.escapeHtml(message, this.feedbackNode, "only");
  }
});
