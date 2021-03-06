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

dojo.provide("rdw.Stories");

dojo.require("rdw._Base");
dojo.require("rdw.Story");
dojo.require("rdw.story.FullStory");
dojo.require("rd.api");

dojo.require("dojo.fx");
dojo.require("dojox.fx.scroll");

dojo.declare("rdw.Stories", [rdw._Base], {
  //Array of conversations to show.
  //Warning: this is a prototype property,
  //be sure to always set it on the instance.
  conversations: [],

  //The max number of messages to fetch from conversation APIs.
  //Note this is number of messages that match a criteria --
  //more messages might show up if they are part of the conversations
  //for the messages that match the criteria.
  messageLimit: 30,

  //The widget to use to show a full story.
  fullStoryCtorName: "rdw.story.FullStory",

  //Widget used for story objects.
  storyCtorName: "rdw.Story",

  //List of topics to listen to and modify contents based
  //on those topics being published. Note that this is an object
  //on the rdw.Stories prototype, so modifying it will affect
  //all instances. Reassign the property to a new object to affect
  //only one instance.
  topics: {
    "rd-engine-sync-done": "checkUpdateInfo",
    "rd-protocol-home": "home",
    "rd-protocol-contact": "contact",
    "rd-protocol-direct": "direct",
    "rd-protocol-group": "group",
    "rd-protocol-locationTag": "locationTag",
    "rd-protocol-starred": "starred",
    "rd-protocol-sent": "sent",
    "rd-protocol-conversation": "conversation",
    "rdw.Story.archive": "archive",
    "rdw.Story.delete": "del",
    "rd-notify-delete-undo": "delUndo"
  },

  //Which topic actions should be considered only transition actions
  //instead of actions that fetch new data.
  transitionOnlyActions: {
    "archive": 1,
    "del": 1
  },

  //List of modules that may want to group messages in the home view.
  //It is assumed that moduleName.prototype.canHandle(messageBag) is defined
  //for each entry in this array.
  homeGroups: [
    "rdw.story.TwitterTimeLine"
  ],

  //The key for navigation.
  navKeys: {
    conversation: dojo.keys.RIGHT_ARROW,
    summary: dojo.keys.LEFT_ARROW,
    up: dojo.keys.UP_ARROW,
    down: dojo.keys.DOWN_ARROW,
    tab: dojo.keys.TAB
  },

  templateString: '<div class="rdwStories" dojoAttachEvent="onclick: onClick, onkeypress: onKeyPress">'
                + '  <ol dojoAttachPoint="listNode"></ol>'
                + '  <ol dojoAttachPoint="convoNode"></ol>'
                + '</div>',

  postMixInProperties: function() {
    //summary: dijit lifecycle method before template is generated.
    this.inherited("postMixInProperties", arguments);

    //Create a reverse up lookup for the nav keys.
    this.navCodes = {};
    for (var prop in this.navKeys) {
      if (!(prop in this.navCodes)) {
        this.navCodes[this.navKeys[prop] + ""] = prop;
      }
    }
  },

  postCreate: function() {
    //summary: dijit lifecycle method after template insertion in the DOM.

    //Register for the interesting topics
    var empty = {};
    for (var prop in this.topics) {
      if(!(prop in empty)) {
        this._sub(prop, this.topics[prop]);
      }
    }
    
    //See if there was a last known state of displayed messages and
    //show them.
    this.checkUpdateInfo();
  },

  //elements to ignore for click selection.
  clickIgnore: {
    "input": 1,
    "textarea": 1,
    "select": 1,
    "option": 1
  },

  onClick: function(/*Event*/evt) {
    //summary: handles click events, tries to select the first selectable item
    //relative to the click.
    var target = evt.target;
    do {
      if (target == this.domNode || this.clickIgnore[target.nodeName.toLowerCase()]) {
        break;
      }
      if (target.tabIndex > -1) {
        this._setActiveNode(target);
        break;
      } else if (dojo.hasClass(target, "rdwStory")) {
        //Went up to Story, so find first focusable node
        var nodes = dojo.query('[tabindex="0"]', target);
        if (nodes.length) {
          this._setActiveNode(nodes[0], null, true);
        }
      }
    } while ((target = target.parentNode));
  },

  onKeyPress: function(/*Event*/evt) {
    //summary: handles key presses for navigation. If the key press is
    //for something that should show a full conversation view then trigger
    //it.
    var key = this.navCodes[evt.keyCode + ""];
    if (key) {
      if (key == "summary" && this.viewType != "summary") {
        this.onNavSummary();
      } else {
        if (key == "conversation" && this.viewType != "conversation") {
          this.onNavConversation();
        } else {
          //Get the active, focused element and see if it is widget with a message
          var id = dojo.doc.activeElement.id;
          var widget = id && dijit.byId(id);
          var found = widget.domNode;
          //It is an up/down action. Show selection of the right element.
          if (key == "up" || key == "down") {
            found = null;

            if (key == "down" && evt.forceFirstActiveItem) {
              //If the focused node is the body, then select first elligible node
              //inside the widget.
              var widgetNodes = dojo.query("[widgetid]", this.domNode);
              if (widgetNodes.length) {
                found = dojo.query("[tabindex]", widgetNodes[0])[0];
              }
            } else {
              //Need to select the next message widget. If it was a tab, it is
              //already selected.
              var method = key == "up" ? "previousSibling" : "nextSibling";
              var found = this._nextFocusNode(widget.domNode, method);
            }

            //If did not find a match then break out.
            if (!found) {
              return;
            }
          }

          this._setActiveNode(found, null, evt.skipAnimation);
          if (!evt._fake) {
            dojo.stopEvent(evt);
          }
        }
      }
    }
  },

  onNavSummary: function() {
    //summary: handles navigating back to the summary view.

    //Store that the state is going back, so do do not
    //fetch new data for the old state.
    this._isBack = true;

    //Save the current scroll position, so we can set it once
    //we go back before we do the transition. Otherwise, the browser
    //remembers your last scroll position for last place in history.
    var conversationScrollTop = dojo.global.dojo.global.scrollY;

    //Just go back in the browser history.
    dojo.global.history.back();

    //Set the scroll back to the right place so the animation looks smooth.
    window.scrollTo(0, conversationScrollTop);
  },
  
  onNavConversation: function() {
    //summary: handles navigating to the conversation view.

    //Get the active, focused element and see if it is widget with a message
    var id = dojo.doc.activeElement.id;
    var widget = id && dijit.byId(id);
    var messageBag = widget && widget.messageBag;

    var convoId = messageBag
                  && messageBag["rd.msg.conversation"]
                  && messageBag["rd.msg.conversation"].conversation_id;
    if (convoId) {
      rd.setFragId("rd:conversation:" + convoId);
    }
  },

  _setActiveNode: function(/*DOMNode*/domNode, /*String?*/viewType, /*Boolean?*/skipAnimation) {
    //summary: sets the active node in the stories area.
    
    //Make sure current node has focus, otherwise, if the transition
    //animation is in mid-progress, the next focusable node will not be
    //found correctly.
    if (this.activeNode) {
      this.activeNode.focus();
    }
    //Also stop any in-process animation for active node.
    if (this.activeNodeAnim) {
      this.activeNodeAnim.stop();
      this.activeNodeAnim = null;
    }

    if (this.activeNode) {
      dojo.removeClass(this.activeNode, "active");
    }
    if (this.activeParentNode) {
      dojo.removeClass(this.activeParentNode, "active");
    }

    //See if click is on the interesting widget node.
    if (dijit.getEnclosingWidget(domNode).domNode != domNode) {
      //Find the more appropriate interesting widget node.
      domNode = dijit.getEnclosingWidget(domNode.parentNode).domNode;
    }

    this.activeNode = domNode;

    //Allow caller to set the viewType this active node call is for.
    viewType = viewType || this.viewType;

    if (viewType == "summary") {
      this.activeParentNode = dijit.getEnclosingWidget(domNode.parentNode).domNode;
      dojo.addClass(this.activeParentNode, "active");
    } else {
      this.activeParentNode = null;
      dojo.addClass(this.activeNode, "active");
    }

    if (skipAnimation) {
      this.activeNode.focus();
    } else {
      //Favor active parent node if available.
      var animNode = this.activeParentNode || this.activeNode;

      var pos = dojo.position(animNode, true);

      //Create the args for the scroll over effect.
      this.activeNodeAnim = dojox.fx.smoothScroll({
        win: dojo.global,
        target: { x: 0, y: Math.min(Math.abs(pos.y - 8), pos.y)},
        easing: this.animEasing,
        duration: 400,
        onEnd: dojo.hitch(this, function() {
          this.activeNode.focus();
        })
      });
      this.activeNodeAnim.play();

      //dijit.scrollIntoView(this.activeNode);
    }
  },

  _nextFocusNode: function(/*DOMNode*/domNode, /*String*/method) {
    //Finds the next focusable widget in the stories hierarchy of nodes.

    //Try node's siblings first, if in a full conversation.
    if (this.viewType == "conversation") {
      var test = domNode;
      while (test && (test = test[method])) {
        if (test && test.tabIndex > -1) {
          return test;
        }
      }
    }

    //No luck with siblings, try up a level at the next Story widget.
    if (domNode) {
      //Go up to hopefully find the story object.
      var storyWidget = dijit.getEnclosingWidget(domNode.parentNode);
      if (storyWidget) {
        domNode = storyWidget.domNode[method];
        var tabbys = domNode && dojo.query('[tabindex="0"]', domNode);
        if (tabbys && tabbys.length) {
          domNode = tabbys[method == "nextSibling" ? 0 : tabbys.length - 1];
          if (domNode && domNode.tabIndex > -1 ) {
            return domNode;
          }
        }
      }
    }
    return null;
  },

  _sub: function(/*String*/topicName, /*String*/funcName) {
    //summary: subscribes to the topicName and dispatches to funcName,
    //saving off the info in case a refresh is needed.
    this.subscribe(topicName, dojo.hitch(this, function() {
      if (topicName != "rd-engine-sync-done") {
        this._updateInfo = {
          funcName: funcName,
          args: arguments
        };
      }

      //If this is a back request or an action that is just a transition
      //action (no new data to fetch), and there are conversations to show,
      //just do the transition back.
      if ((this._isBack) && this.conversations && this.conversations.length) {
        //Just transition back to summary view, do not fetch new data.
        this.transition("summary");
      } else if (this.transitionOnlyActions[funcName]) {
        this[funcName].apply(this, arguments);
      } else {
        //Clear out info we were saving for back.
        this.summaryActiveNode = null;
        this.summaryScrollHeight = 0;
        this[funcName].apply(this, arguments);
      }
      this._isBack = false;
    }));
  },

  checkUpdateInfo: function() {
    //summary: Sees if last request should be updated.
    var info = this._updateInfo;
    if (info) {
      this[info.funcName].apply(this, info.args);
    }
  },

  updateConversations: function(/*String*/viewType, /*Array*/conversations) {
    //summary: updates the display of conversations by updating the
    //rdw.Story objects.
    //TODO: try to reuse a Story object instead of destroy/create
    //cycle. Could cause too much memory churn in the browser.

    //Hold on to conversations in case we need to refresh based on extension
    //action.
    if (viewType == "conversation") {
      this.oneConversation = conversations[0];

      //Clean up old convoWidget
      if (this.convoWidget) {
        this.removeSupporting(this.convoWidget);
        this.convoWidget.destroy();
      }

      //Make new convoWidget.
      var ctor = dojo.getObject(this.fullStoryCtorName);
      this.convoWidget = new ctor({
        msgs: this.oneConversation
      }, dojo.create("div", null, this.convoNode));
    } else {
      this.destroyAllSupporting();

      //Showing summaries of a few conversations.
      this.conversations = conversations;

      //Create new widgets.
      //Use a document fragment for best performance
      //and load up each story widget in there.
      var frag = dojo.doc.createDocumentFragment();
      for (var i = 0, conv; conv = this.conversations[i]; i++) {
        this.addSupporting(new (dojo.getObject(this.storyCtorName))({
           msgs: conv
         }, dojo.create("div", null, frag)));        
      }

      //Inject nodes all at once for best performance.
      this.listNode.appendChild(frag);

      this.configureFirstActiveItem();
    }

    this.transition(viewType);
  },

  transition: function(/*String*/viewType) {
    //summary: transitions the display to the appropriate
    //viewType. Basically, allow switching from a summary
    //of conversations to one conversation and back.

    console.log("transition: start");

    //If showing another summary type, then clear out the saved summary
    if (!this.viewType || viewType == this.viewType && viewType == "summary") {
      this.summaryScrollHeight = 0;
    }

    //If transitioning away from summary, hold on to old activeNode
    if (viewType == "summary") {
      if (this.summaryActiveNode) {
        this._setActiveNode(this.summaryActiveNode, "summary", true);
      }
    } else {
      this.summaryActiveNode = this.activeNode;
    }

    //Skip the animation on the first display of this widget.
    if (!this._postRender) {
      //Set the view type so next calls know the type.
      this.viewType = viewType;
      this._postRender = true;
      console.log("transition: end, no animation.");
      this.checkTransitionEnd();
      return;
    }

    if (this.viewType == viewType) {
      this.checkTransitionEnd();
    } else {
      if (!this.switchNode) {
        this.switchNode = dojo.create("div", {
          "class": "rdwStoriesSwipe"
        }, dojo.body());
      }
      this.switchNode.className = "rdwStoriesSwipe " + viewType;

      //Do the transition in a timeout, to give the DOM a chance to render,
      //so DOM rendering work is not happening while the transition is going.
      setTimeout(dojo.hitch(this, function() {
          //For summary view going to conversation view, remember the vertical scroll
          //to restore it when switching back.
          if (this.viewType != "conversation") {
            this.summaryScrollHeight = dojo.global.scrollY;
          }

          //Create a div used for scrolling.
          if (!this._scrollNode) {
            this._scrollNode = dojo.create("div", { "class": "scrollArea"});
          }
    
          //Fix the widths of divs for the scroll effect to work.
          var newDomNodeWidth, newListNodeWidth, newConvoNodeWidth;
          var oldDomNodeWidth = this.domNode.style.width;
          this.domNode.style.width = (newDomNodeWidth = dojo.marginBox(this.domNode).w) + "px";
          var oldListNodeWidth = this.listNode.style.width;
          this.listNode.style.width = newDomNodeWidth + "px";
          var oldConvoNodeWidth = this.convoNode.style.width;
          this.convoNode.style.width = newDomNodeWidth + "px";
   
          //Use the scrollNode as the parent, to make things easy to scroll.
          this._scrollNode.appendChild(this.listNode);
          this._scrollNode.appendChild(this.convoNode);
          this.domNode.appendChild(this._scrollNode);
     
          //Make sure both lists are visible.
          this.listNode.style.display = "";
          this.convoNode.style.display = "";
    
          if (viewType == "conversation") {
            this.domNode.scrollLeft = 0;
            var x = newDomNodeWidth;
          } else {
            this.domNode.scrollLeft = newDomNodeWidth;
            x = 0;
          }
  
          //Create the args for the scroll over effect.
          var scrollHorizAnim = dojox.fx.smoothScroll({
            win: this.domNode,
            target: { x: x, y: 0},
            easing: this.animEasing,
            duration: 600
          });
  
          if (viewType == "conversation") {
            //Pick a vertical position that is at the top of the Stories widget,
            //if current scroll position is less.
            var scrollHeight = dojo.global.scrollY;
            var position = dojo.position(this.domNode, true).y;
            if (position < scrollHeight) {
              scrollHeight = position;
            }

            //Set up vertical animation.
            var scrollVertAnim = dojox.fx.smoothScroll({
              win: dojo.global,
              target: { x: 0, y: scrollHeight},
              easing: this.animEasing,
              duration: 600
            });

            //Going to conversation. scroll vertical then horizontal.
            var chain = dojo.fx.chain([
              scrollHorizAnim,
              scrollVertAnim
            ]);
          } else {
            //Set up vertical animation.
            var scrollVertAnim = dojox.fx.smoothScroll({
              win: dojo.global,
              target: { x: 0, y: this.summaryScrollHeight},
              easing: this.animEasing,
              duration: 600
            });
            //Going back to summary view. Scroll horizontal, then vertical
            var chain = dojo.fx.chain([
              scrollHorizAnim,
              scrollVertAnim
            ]);
          }

          //Bind to the end of the fx chain, then play the chain.
          dojo.connect(chain, "onEnd", dojo.hitch(this, function() {
            //Reset the DOM nodes after the animation is done.
            //Only show the correct node.
            if (viewType == "conversation") {
              this.listNode.style.display = "none";
              this.convoNode.style.display = "";       
            } else {
              this.listNode.style.display = "";
              this.convoNode.style.display = "none";       
            }
  
            //Pull the nodes out scrollNode          
            this.domNode.removeChild(this._scrollNode);
            this.domNode.appendChild(this.listNode);
            this.domNode.appendChild(this.convoNode);
  
            //Remove fixed widths on the nodes.
            this.domNode.style.width = oldDomNodeWidth;
            this.listNode.style.width = oldListNodeWidth;
            this.convoNode.style.width = oldConvoNodeWidth;
            
            //Reset scroll.
            this.domNode.scrollLeft = 0;

            this.onTransitionEnd();
          }));
          chain.play();

          //Set current state of the viewType. Do it here and not in
          //onTransitionEnd in case user causes an action before the
          //animation is done.
          this.viewType = viewType;
      }), 100);
    }
  },

  animEasing: function(/* Decimal? */n){
    //summary: easing function for animations. This is a copy of
    //dojo.fx.easing.expoOut
    return (n == 1) ? 1 : (-1 * Math.pow(2, -10 * n) + 1);
  },

  removeAnimEasing: function(/* Decimal? */n){
    //summary: easing function for animations. This is a copy of
    //the default easing function for dojo.Animation(s)
    return 0.5 + ((Math.sin((n + 1.5) * Math.PI)) / 2);
  },

  onTransitionEnd: function() {
    //summary: called at the end of a summary transition.

    console.log("onTransitionEnd");

    //Hide the swipe indicator
    this.switchNode.className = "rdwStoriesSwipe";

    if (this.viewType == "summary") {
      if (this.summaryActiveNode) {
        this._setActiveNode(this.summaryActiveNode, null, true);
      }
    } else {
      //Select the first focusable node in the conversation.
      var tabbys = dojo.query('[tabindex="0"]', this.convoWidget.domNode);
      if (tabbys.length) {
        this._setActiveNode(tabbys[0], null, true);
      }

      //Set the read state
      rd.api().seen({
        ids: this.oneConversation
      });
    }
    this.checkTransitionEnd();
  },

  checkTransitionEnd: function() {
    //summary: checks for an action to run after the end of the transition.
    if (this.onTransitionEndCallback) {
      setTimeout(dojo.hitch(this, function() {
        this.onTransitionEndCallback();
        delete this.onTransitionEndCallback;
      }), 15);
    }
  },

  configureFirstActiveItem: function() {
    //summary: sets the transition callback to select the first
    //item in the updated list. Only do this for actions that
    //refresh the displayed list of items.

    this.onTransitionEndCallback = dojo.hitch(this, function() {
      //Select the first element in the list.
      setTimeout(dojo.hitch(this, function() {
        this.onKeyPress({
          keyCode: this.navKeys.down,
          forceFirstActiveItem: true,
          skipAnimation: true,
          _fake: true
        });
        rd.pub("rdw.Stories.firstItemSelected");
      }), 500);
    });
  },

  destroy: function() {
    //summary: dijit lifecycle method. Be sure to get rid
    //of anything we do not want if this widget is re-instantiated,
    //like for on-the-fly extension purposes.
    if (this.convoWidget) {
      this.convoWidget.destroy();
    }
    if (this.activeNode) {
      delete this.activeNode;
    }
    if (this.activeParentNode) {
      delete this.activeParentNode;
    }
    if (this.summaryActiveNode) {
      delete this.summaryActiveNode;
    }

    this.inherited("destroy", arguments);
  },

  removeStory: function(/*Object*/storyWidget, /*Function?*/onEndCallback) {
    //summary: removes a story from this widget.
    var node = storyWidget.domNode;

    //Find next story to highlight.  
    var nextNode = dojo.query(node).next()[0];
    if (nextNode) {
      var nodes = dojo.query('[tabindex="0"]', nextNode);
      nextNode = nodes.length ? nodes[0] : null;
    }

    //First, animate it out.
    node.style.overflow = "hidden";
    dojo.anim(node, { height: 0}, 800, this.removeAnimEasing, dojo.hitch(this, function() {
      //Then destroy it.
      this.removeSupporting(storyWidget);
      storyWidget.destroy();

      //select next node. Use a timeout for smoothness.
      setTimeout(dojo.hitch(this, function() {
        if (nextNode) {
          this._setActiveNode(nextNode);
        }
      }), 10);
    }));
  },

  //**************************************************
  //start topic subscription endpoints
  //**************************************************
  home: function() {
    //summary: responds to rd-protocol-home topic.

    console.log("starting home request");

    //reset stored state.
    this.conversations = [];
    //Indicate this is a collection of home conversations.
    this.conversations._rdwStoriesType = "home";
    this._groups = [];

    //Be sure homeGroups are loaded.
    console.log("loading group modules.");

    if (!this.homeGroupModules) {
      for (var i = 0, module; module = this.homeGroups[i]; i++) {
        dojo["require"](module);
      }

      dojo.addOnLoad(dojo.hitch(this, function(){
        console.log("finished loading group modules.");
        this.homeGroupModules = [];
        for (var i = 0, module; module = this.homeGroups[i]; i++) {
          var mod = dojo.getObject(module);
          this.homeGroupModules.push(mod);
        }
        this.destroyAllSupporting();
        this._renderHome();
      }));
    } else {
      this.destroyAllSupporting();
      this._renderHome();
    }
  },

  _renderHome: function() {
    //summary: does the actual display of the home view.
    console.log("_renderHome start");
    rd.conversation.home(this.messageLimit, dojo.hitch(this, function(conversations) {
      console.log("_renderHome conversations received");
       //The home view groups messages by type. So, for each message in each conversation,
      //figure out where to put it.
      if (conversations && conversations.length) {
        this.conversations.push.apply(this.conversations, conversations);

        for (var i = 0, convo; convo = conversations[i]; i++) {
          var leftOver = [];
          for (var j = 0, msgBag; msgBag = convo[j]; j++) {
            //Feed the message to existing created groups.
            if (!this._groupHandled(msgBag)) {
              //Existing group could not handle it, see if there is a new group
              //handler that can handle it.
              var handler = this._getHomeGroup(msgBag);
              if (handler) {
                var widget = new handler({
                  msgs: [msgBag],
                  displayOnCreate: false
                }, dojo.create("div"));
                widget._isGroup = true;
                this._groups.push(widget);
                this.addSupporting(widget);
              } else {
                leftOver.push(msgBag);
              }
            }
          }

          //If any messsages not handled by a group in a conversation
          //are left over, create a regular story for them.
          if (leftOver.length) {
            var widget = this.createHomeStory(leftOver);
            this._groups.push(widget);
            this.addSupporting(widget);
          }
        }
      }

      this._sortGroups();

      //Add all the widgets to the DOM and ask them to display.
      console.log("_renderHome starting to display widgets");
      var frag = dojo.doc.createDocumentFragment();
      for (var i = 0, group; group = this._groups[i]; i++) {
        group.placeAt(frag);
        group.display();
      }

      console.log("_renderHome ending display widgets");

      //Inject nodes all at once for best performance.
      this.listNode.appendChild(frag);

      console.log("_renderHome widgets injected into the dom");

      this.configureFirstActiveItem();
      this.transition("summary");
    }));
  },

  createHomeStory: function(/*Array*/msgs) {
    //summary: creates a Story widget for the Home view. The Story widget
    //should not display itself immediately since prioritization of the home
    //widgets still needs to be done. Similarly, it should not try to attach
    //to the document's DOM yet. Override for more custom behavior/subclasses.
    return new (dojo.getObject(this.storyCtorName))({
      msgs: msgs,
      unreadReplyLimit: 2,
      displayOnCreate: false,
      allowReplyMessageFocus: false
    }, dojo.create("div")); //rdw.Story
  },

  _sortGroups: function() {
    //summary: handles sorting the groups. Default behavior
    //is to have true groups at the bottom, below regular
    //message groups.
    var regular = [];
    var groupie = [];
    for (var i = 0, group; group = this._groups[i]; i++) {
      group._isGroup ? groupie.push(group) : regular.push(group);
    }
    this._groups = regular.concat(groupie);
  },

  _groupHandled: function(/*Object*/msgBag) {
    //summary: if a group in the groups array can handle the msgBag, give
    //it to that group and return true.
    for (var i = 0, group; group = this._groups[i]; i++) {
      if (group.canHandle && group.canHandle(msgBag)) {
        group.addMessage(msgBag);
        return true;
      }
    }
    return false;
  },

  _getHomeGroup: function(/*Object*/msgBag) {
    //summary: determines if there is a home group that can handle the message.
    for (var i = 0, module; module = this.homeGroupModules[i]; i++) {
      if (module.prototype.canHandle(msgBag)) {
        return module;
      }
    }
    return null;
  },

  contact: function(/*String*/contactId) {
    //summary: responds to rd-protocol-contact topic.
    rd.conversation.contact(contactId, dojo.hitch(this, "updateConversations", "summary"));
  },

  direct: function() {
    //summary: responds to rd-protocol-direct topic.
    rd.conversation.direct(this.messageLimit, dojo.hitch(this, "updateConversations", "summary"));
  },

  group: function() {
    //summary: responds to rd-protocol-group topic.
    rd.conversation.group(this.messageLimit, dojo.hitch(this, "updateConversations", "summary"));
  },

  locationTag: function(/*String*/locationId) {
    //summary: responds to rd-protocol-locationTag topic.

    //Convert string to array.
    if (typeof locationId == "string") {
      locationId = locationId.split(",");
    }

    rd.conversation.location(locationId, this.messageLimit, dojo.hitch(this, "updateConversations", "summary"));
  },

  starred: function() {
    //summary: responds to rd-protocol-starred topic.
    rd.conversation.starred(this.messageLimit, dojo.hitch(this, "updateConversations", "summary"));
  },

  sent: function() {
    //summary: responds to rd-protocol-sent topic.
    rd.conversation.sent(this.messageLimit, dojo.hitch(this, "updateConversations", "summary"));
  },

  conversation: function(/*String*/convoId) {
    //summary: responds to requests to view a conversation.
    rd.api().conversation({
      ids: [convoId]
    })
    .ok(dojo.hitch(this, "updateConversations", "conversation"));
  },

  archive: function(/*Object*/storyWidget, /*Array*/messageBags) {
    //summary: handles archiving a story and cleaning up visual state as
    //a result of the change.
    rd.api().archive({
      ids: messageBags
    })
    .ok(this, function() {
      if (this.viewType == "summary") {
        this.removeStory(storyWidget);
      } else {
        this.onTransitionEndCallback = dojo.hitch(this, function() {
          //Assume the selected node is the Story node.
          var summaryStoryWidget = dijit.getEnclosingWidget(this.activeParentNode);

          //If going back to home view, need to remove the item,
          //otherwise, just update the other story in place.
          if (this.conversations._rdwStoriesType == "home") {
            this.removeStory(summaryStoryWidget);
          } else {
            rd._updateInstance(summaryStoryWidget, dojo.getObject(summaryStoryWidget.declaredClass));
          }
        });
        this.onNavSummary();
      }
    });
  },

  del: function(/*Object*/storyWidget, /*Array*/messageBags) {
    //summary: handles deleting a story and cleaning up visual state as
    //a result of the change.
    rd.api().del({
      ids: messageBags
    })
    .ok(this, function() {
      if (this.viewType == "summary") {
        var msgs = storyWidget.msgs;

        this.removeStory(storyWidget);

        //Notify the user of the delete.
        rd.pub("rd-notify-delete", msgs);
      } else {
        this.onTransitionEndCallback = dojo.hitch(this, function() {
          //Assume the selected node is the Story node.
          var summaryStoryWidget = dijit.getEnclosingWidget(this.activeParentNode);
          var msgs = summaryStoryWidget.msgs;

          //Remove the story
          this.removeStory(summaryStoryWidget);

          //Notify the user of the delete.
          rd.pub("rd-notify-delete", msgs);
        });
        this.onNavSummary();
      }
    });
  },

  delUndo: function(/*Array*/msgs) {
    //summary: undos a deletion of a set of messages.
    alert("not working yet.");
  }
  //**************************************************
  //end topic subscription endpoints
  //**************************************************
});

