/*
	Copyright (c) 2004-2009, The Dojo Foundation All Rights Reserved.
	Available via Academic Free License >= 2.1 OR the modified BSD license.
	see: http://dojotoolkit.org/license for details
*/


if(!dojo._hasResource["bespin.editor.piemenu"]){ //_hasResource checks added by build. Do not use _hasResource directly in your code.
dojo._hasResource["bespin.editor.piemenu"] = true;
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License
 * Version 1.1 (the "License"); you may not use this file except in
 * compliance with the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS"
 * basis, WITHOUT WARRANTY OF ANY KIND, either express or implied.
 * See the License for the specific language governing rights and
 * limitations under the License.
 *
 * The Original Code is Bespin.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Bespin Team (bespin@mozilla.com)
 *
 * ***** END LICENSE BLOCK ***** */

dojo.provide("bespin.editor.piemenu");

dojo.declare("bespin.editor.filepopup.MainPanel", null, {
    constructor: function(canvas, insets) {
        var scene = new th.Scene(canvas);

        // make the root transparent
        scene.root.paintSelf = function() {}

        var panel = new th.Panel();
        panel.addCss("background-color", "blue");

        scene.root.add(panel);
        scene.root.layout = function() {
            var d = this.d();

            panel.bounds = {
                x: d.b.x + insets.left,
                y: d.b.y + insets.top,
                width: d.b.w - insets.left - insets.right,
                height: d.b.h - insets.top - insets.bottom
            }
        }

        this.scene = scene;
        this.panel = panel;
    },

    show: function() {
        this.panel.addCss("display", "block");
        this.scene.render();
    },

    hide: function() {
        this.panel.addCss("display", "none");
        this.scene.render();
    }
});

}
