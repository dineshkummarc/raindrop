#!/usr/bin/env python
"""The raindrop server
"""
import sys
import optparse
import logging
import json

from twisted.internet import reactor, defer, task
from twisted.python.failure import Failure

from raindrop import model
from raindrop import bootstrap
from raindrop import pipeline
from raindrop import opts
from raindrop.sync import get_conductor

logger = logging.getLogger('raindrop')

g_pipeline = None

class HelpFormatter(optparse.IndentedHelpFormatter):
    def format_description(self, description):
        return description

# decorators for our global functions:
#  so they can consume the rest of the args
def allargs_command(f):
    f.allargs = True
    return f


# XXX - install_accounts should die too, but how to make a safe 'fingerprint'
# so we can do it implicitly? We could create a hash which doesn't include
# the password, but then the password changing wouldn't be enough to trigger
# an update.  Including even the *hash* of the password might risk leaking
# info.  So for now you must install manually.
def install_accounts(result, parser, options):
    """Install accounts in the database from the config file"""
    return bootstrap.install_accounts(None)

@defer.inlineCallbacks
def show_info(result, parser, options):
    """Print a list of all extensions, loggers etc"""
    dm = model.get_doc_model()
    print "Database:"
    info = yield dm.db.infoDB()
    fmt = "  %(doc_count)d docs total, %(doc_del_count)d deleted, " \
          "update seq at %(update_seq)d, %(disk_size)d bytes."
    print fmt % info
    # ouch - this seems a painful way of fetching total unique keys?
    results = yield dm.open_view(
                startkey=["rd.core.content", "key"],
                endkey=["rd.core.content", "key", {}],
                group_level=3)
    print "  %d unique raindrop keys" % len(results['rows'])

    print "Document counts by schema:"
    results = yield dm.open_view(
                startkey=["rd.core.content", "schema_id"],
                endkey=["rd.core.content", "schema_id", {}],
                group_level=3)
    infos = []
    for row in results['rows']:
        sch_id = row['key'][-1]
        infos.append((sch_id, row['value']))
    for sch_id, count in sorted(infos):
        print "  %s: %d" % (sch_id, count)
    print

    print "Raindrop extensions:"
    exts = sorted(pipeline.extensions.items()) # sort by ID.
    for _, ext in exts:
        print "  %s: %s" % (ext.id, ext.doc['info'])
    print
    print "Loggers"
    # yuck - reach into impl - and hope all have been initialized by now
    # (they should have been as we loaded the extensions above)
    for name in logging.Logger.manager.loggerDict:
        print " ", name

    
@defer.inlineCallbacks
def sync_messages(result, parser, options):
    """Synchronize all messages from all accounts"""
    conductor = get_conductor()
    _ = yield conductor.sync(g_pipeline)

def process(result, parser, options):
    """Process all messages to see if any extensions need running"""
    def done(result):
        print "Message pipeline has finished - created", result, "docs"
    return g_pipeline.start().addCallback(done)

def reprocess(result, parser, options):
    """Reprocess all messages even if they are up to date."""
    def done(result):
        print "Message pipeline has finished..."
    return g_pipeline.reprocess().addCallback(done)

def retry_errors(result, parser, options):
    """Reprocess all conversions which previously resulted in an error."""
    def done_errors(result):
        print "Error retry pipeline has finished - processing work queue..."
        return result
    return g_pipeline.start_retry_errors(
                ).addCallback(done_errors
                ).addCallback(process, parser, options)

@allargs_command
def show_view(result, parser, options, args):
    """Pretty-print the result of executing a view.

    All arguments after this command are URLs to be executed as the view.  If
    the view name starts with '/', the URL will be used as-is.  This is
    suitable for builtin views - eg:

        show-view /_all_docs?limit=5
    
    will fetch the first 5 results from the URL:

        http://[dbhost]/[dbname]/_all_docs?limit=5"

    whereas

        show-view my_design_doc/my_view?limit=5

    will fetch the first 5 results from the URL

        http://[dbhost]/[dbname]/_design/my_design_doc/_view/my_view?limit=5

    """
    from pprint import pprint
    def print_view(result, view_name):
        print "** view %r **" % view_name
        pprint(result)

    def gen_views():
        for arg in args:
            # don't use open_view as then we'd need to parse the query portion!
            # grrr - just to get the dbname :()
            from raindrop.config import get_config
            dbinfo = get_config().couches['local']
            dbname = dbinfo['name']
            if arg.startswith("/"):
                uri = "/%s/%s" % (dbname, arg)
            else:
                try:
                    doc, rest = arg.split("/")
                except ValueError:
                    parser.error("View name must be in the form design_doc_name/view")
                uri = "/%s/_design/%s/_view/%s" % (dbname, doc, rest)
            db = model.get_db()
            yield db.get(uri
                ).addCallback(db.parseResult
                ).addCallback(print_view, arg)

    coop = task.Cooperator()
    return coop.coiterate(gen_views())


def unprocess(result, parser, options):
    """Delete all documents which can be re-generated by the 'process' command
    """
    def done(result):
        print "unprocess has finished..."
    return g_pipeline.unprocess().addCallback(done)

def delete_docs(result, parser, options):
    """Delete all documents of a particular type.  Use with caution or see
       the 'unprocess' command for an alternative.
    """
    # NOTE: This is for development only, until we get a way to say
    # 'reprocess stuff you've already done' - in the meantime deleting those
    # intermediate docs has the same result...
    def _del_docs(to_del):
        docs = []
        for id, rev in to_del:
            docs.append({'_id': id, '_rev': rev, '_deleted': True})
        return model.get_db().updateDocuments(docs)

    def _got_docs(result, dt):
        to_del = [(row['id'], row['value']['_rev']) for row in result['rows']]
        logger.info("Deleting %d documents of type %r", len(to_del), dt)
        return to_del

    if not options.schemas:
        parser.error("You must specify one or more --schema")
    deferreds = []
    for st in options.schemas:
        key = ['rd.core.content', 'schema_id', st]
        d = model.get_doc_model().open_view(key=key, reduce=False
                ).addCallback(_got_docs, st
                ).addCallback(_del_docs
                )
        deferreds.append(d)
    return defer.DeferredList(deferreds)


def main():
    # build the args we support.
    all_args = {}
    for n, v in globals().iteritems():
        if callable(v) and getattr(v, '__doc__', None):
            all_args[n.replace('_', '-')] = v

    all_arg_names = sorted(all_args.keys())
    description= __doc__ + "\nCommands\n  help\n  " + \
                 "\n  ".join(all_args.keys()) + \
                 "\nUse '%prog help command-name' for help on a specific command.\n"

    parser = optparse.OptionParser("%prog [options]",
                                   description=description,
                                   formatter=HelpFormatter())

    for opt in opts.get_program_options():
        parser.add_option(opt)
    for opt in opts.get_request_options():
        parser.add_option(opt)
    options, args = parser.parse_args()

    opts.setup_logging(options)

    # do this very early just to set the options
    get_conductor(options)

    # patch up keys.
    if options.keys:
        def _fix_unicode(result):
            if isinstance(result, list):
                for i, v in enumerate(result):
                    result[i] = _fix_unicode(result[i])
            elif isinstance(result, unicode):
                result = result.encode('utf-8')
            return result
        for i, val in enumerate(options.keys):
            try:
                # help windows - replace single quote with double...
                val = val.replace("'", '"')
                options.keys[i] = _fix_unicode(json.loads(val))
            except ValueError, why:
                parser.error("Invalid key value %r: %s" % (val, why))

    if args and args[0]=='help':
        if args[1:]:
            which = args[1:]
        else:
            which = all_args.keys()
        for this in which:
            if this=='help': # ie, 'help help'
                doc = "show help for the commands."
            else:
                try:
                    doc = all_args[this].__doc__
                except KeyError:
                    print "No such command '%s':" % this
                    continue
            print "Help for command '%s':" % this
            print doc
            print
    
        sys.exit(0)

    # create an initial deferred to perform tasks which must occur before we
    # can start.  The final callback added will fire up the real servers.
    d = defer.Deferred()
    def mutter(whateva):
        print "Raindrops keep falling on my head..."
    d.addCallback(mutter)

    # Check DB exists and if not, install accounts.
    def maybe_install_accounts(db_created):
        if db_created:
            return bootstrap.install_accounts(None)
    d.addCallback(model.fab_db
        ).addCallback(maybe_install_accounts
        )
    # Check if the files on the filesystem need updating.
    d.addCallback(bootstrap.install_client_files, options)
    d.addCallback(bootstrap.insert_default_docs, options)
    d.addCallback(bootstrap.install_views, options)
    d.addCallback(bootstrap.update_apps)

    @defer.inlineCallbacks
    def setup_pipeline(whateva):
        global g_pipeline
        if g_pipeline is None:
            g_pipeline = pipeline.Pipeline(model.get_doc_model(), options)
            _ = yield g_pipeline.initialize()
    d.addCallback(setup_pipeline)

    # Now process the args specified.
    for i, arg in enumerate(args):
        try:
            func = all_args[arg]
        except KeyError:
            parser.error("Invalid command: " + arg)

        consumes_args = getattr(func, 'allargs', False)
        if consumes_args:
            d.addCallback(func, parser, options, args[i+1:])
            break
        else:
            d.addCallback(func, parser, options)

    # and some final deferreds to control the process itself.
    def done(whateva):
        if reactor.running:
            print "Apparently everything is finished - terminating."
            reactor.stop()

    def error(*args, **kw):
        from twisted.python import log
        log.err(*args, **kw)
        print "A command failed - terminating."
        reactor.stop()

    d.addCallbacks(done, error)

    reactor.callWhenRunning(d.callback, None)

    logger.debug('starting reactor')
    reactor.run()
    logger.debug('reactor done')


if __name__=='__main__':
    main()
