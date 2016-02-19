var db;
var updateConflictCB;
var insertCB;
var onChangeCB;
var remoteCouch;
var docToBePut;

//Making a copy of the default PouchDB.put and PouchDB.post functions
PouchDB.prototype._put_base = PouchDB.prototype.put;
PouchDB.prototype._post_base = PouchDB.prototype.post;

//Altering the PouchDB.post function to bind the document as a parameter
PouchDB.prototype.post = function (doc, callback) {

    var docid = doc._id;
    var rev = doc._rev;

    if (callback != null)
        this._post_base(doc, callback.bind(this, doc));
    else
        this._post_base(doc);

}

//Altering the PouchDB.put function to bind the document as a parameter
PouchDB.prototype.put = function (doc, callback) {

    var docid = doc._id;
    var rev = doc._rev;

    if (callback != null)
        this._put_base(doc, callback.bind(this, doc));
    else
        this._put_base(doc);

}

/**
    Initialisation function
    onConflictCallback: Callback function to be used for every conflict which arises
    onChangeCallback: Callback function to be used for every change action
    dbName: Name of PouchDB node to be created/used
    remoteURL: IP/DB name of CouchDB node in that format
*/
function init(onConflictCallback, onChangeCallback, dbName, remoteURL) {
    db = new PouchDB(dbName);
    remoteCouch = remoteURL;

    //Setup the conflict and change callbacks
    updateConflictCB = onConflictCallback;
    onChangeCB = onChangeCallback;

    //Initialise first sync operation 
    sync();

    //Set an onChange listener
    db.changes({
        since: 'now',
        live: true,
        include_docs: true,
        conflicts: true
    }).on('change', function (info) {

        if (info.deleted) {
            // document was deleted
            console.log("Delete was made");

        } else {
            // document was updated
            console.log("Update was made");

            var conflicts = info.doc._conflicts;

            //If the document includes a conflicts array
            if (conflicts != null) {

                //For each conflict in the array, check whether any one matches the current conflict
                for (var i = 0; i < conflicts.length; i++) {
                    var conflict = conflicts[i];

                    var rev_parts = conflict.split("-");
                    if (info.doc._rev.startsWith(rev_parts[0] + "-")) {
                        //conflict = conflicting version
                        //chosen by couchdb = winning version

                        console.log('An update conflict occured');
                        updateConflictCB(info.doc, conflict);
                        //info.doc is the entire chosen doc, conflict is just the conflicting rev num
                    }
                }
            }

        }

        onChangeCB();

    });
}

/**
    Initialise a sync operation with the remote CouchDB server
*/
function sync() {
    var opts = { live: true, conflicts: true, retry: true };
    db.sync(remoteCouch, opts
    ).on('change', function (change) {
        onChangeCB();
        console.log(change);
        console.log('to change');
    }).on('paused', function () {
        console.log('to paused');
    }).on('active', function () {
        console.log('to active');
    }).on('error', function (err) {
        console.log('to error');
    });

}

/**
    INSERT - Immediate Conflict Resolution - Attempts to re-insert using a different ID
*/
function insertRetry(doc, err, result) {
    if (!err) {
        if (result && result.ok) {
            console.log('Insert operation carried out successfully.');
        }
    }
    else {
        if (err.status === 409) {
            console.log('Insert operation resulted in a conflict. Retry in progress.');
            doc._id = null;
            db.post(doc, insertNoRetry);
        }
    }
};

/**
    INSERT - Immediate Conflict Resolution - Attempts no re-insert 
*/
function insertNoRetry(doc, err, result) {
    if (!err) {
        if (result && result.ok) {
            console.log('Insert operation carried out successfully.');
        }
    }
    else {
        if (err.status === 409) {
            console.log('Insert operation resulted in a conflict - Error 409.');
        }
        else {
            console.log('Insert operation could not pe performed.');
        }
    }
};

/**
    Update - Immediate update conflict - Attempt re-using new revision number
*/
function updateNewRevNum(doc, err, response) {

    var _doc = doc;
    //update using a new revision number
    if (err && err.status == '409') {
        db.get(_doc._id).then(function (doc) {
            console.log('Re-attempting update with new revision number');
            _doc._rev = doc._rev;
            db.put(_doc).then(function (response) {
                console.log(response);
            }).catch(function (err) {
                console.log(err);
            });
        }).catch(function (err) {
            console.log('error');
        });

    }
}

/**
    Update - Immediate update conflict - Don't re-attempt update
*/
function updateReject(doc, err, response) {

    if (err && err.status == '409') {
        console.log('A conflict occured. Update has been rejected.');
        console.log(doc);
    }

    onChangeCB();
}

/**
   Replication -  Eventual conflict - Agree with CouchDB's descision 
*/
function replicationAgree(doc, err, response) {
    var conflicts = doc._conflicts;

    if (conflicts != null) {

        for (var i = 0; i < conflicts.length; i++) {
            var conflict = conflicts[i];

            var rev_parts = conflict.split("-");
            if (doc._rev.startsWith(rev_parts[0] + "-")) {

                db.remove(doc._id, conflict);
            }
        }
    }
    else {
        //there must have been a mistake 
    }
}

/**
    Replication -  Eventual conflict - Merge documents
    doc: the document declared as the winner by CouchDB
    conf: revision number of the conflicting document
*/
function replicationMerge(doc, conf, err, response) {
    var original;
    var rejected;
    var chosen = doc;

    //get all the revisions of the winning document
    var opts = { revs: true };
    db.get(chosen._id, opts).then(function (doc) {

        var all_revs = doc._revisions;

        var split_revno = doc._rev.split("-");

        var current_revno = split_revno[0];
        var required_revno = (parseInt(current_revno) - 1).toString() + "-" + all_revs.ids[1];

        var options = { rev: required_revno };
        db.get(chosen._id, options).then(function (doc) {

            original = doc;
            var options_rej = { rev: conf };
            db.get(doc._id, options_rej).then(function (doc) {

                rejected = doc;
                var result_or_cho = {};
                var result_or_rej = {};

                for (var p in original) {
                    if (original.hasOwnProperty(p)) {
                        if (chosen.hasOwnProperty(p)) {
                            if (original[p] == chosen[p]) {
                                //values are equal
                                result_or_cho[p] = 0;
                            }
                            else {
                                //values not equal - change was done
                                result_or_cho[p] = 1;
                            }
                        }

                        if (rejected.hasOwnProperty(p)) {
                            if (original[p] == rejected[p]) {
                                //values are equal
                                result_or_rej[p] = 0;
                            }
                            else {
                                //values not equal - change was done
                                result_or_rej[p] = 1;
                            }
                        }
                    }
                }

                for (var p in chosen) {
                    if (chosen.hasOwnProperty(p)) {
                        if (!original.hasOwnProperty(p)) {
                            //this property has been added to the chosen doc but was not in original
                            result_or_cho[p] = 1;
                        }
                    }
                }

                for (var p in rejected) {
                    if (rejected.hasOwnProperty(p)) {
                        if (!original.hasOwnProperty(p)) {
                            //this property has been added to the rejected doc but was not in original
                            result_or_rej[p] = 1;
                        }
                    }
                }

                var newdoc = {};
                //for each key in result_or_cho
                for (var q in result_or_cho) {
                    //if that key is also in result_or_rej, compare the values
                    if (result_or_rej[q]) {
                        if (result_or_cho[q] == 0) {
                            if (result_or_rej[q] == 0) {
                                //everything is like the original
                            }
                            else {
                                newdoc[q] = rejected[q];
                            }
                        }
                        else {
                            if (result_or_rej[q] == 0) {
                                newdoc[q] = chosen[q];
                            }
                            else {
                                //need to pick arbitrary winner
                                newdoc[q] = chosen[q];
                            }
                        }
                    }
                    else {
                        //the key is in result_or_cho but not in result_or_rej
                        newdoc[q] = chosen[q];
                    }
                }

                //add what wasnt in cho but is in rej to new doc
                for (var q in result_or_rej) {
                    if (result_or_cho[q] == null) {
                        newdoc[q] = rejected[q];
                    }
                }

                console.log(result_or_cho);
                console.log(result_or_rej);
                console.log(newdoc);

                db.put(newdoc);

            }).catch(function (err) {
                console.log(err);
            });

        }).catch(function (err) {
            console.log(err);
        });

    }).catch(function (err) {
        console.log(err);
    });


}




//function deletePermanent(doc) {

//    var docid = info.doc._id;
//    var rev = info.doc._rev;

//    db.allDocs({
//        include_docs: true,
//        keys : [docid]
//    }).then(function (result) {
//        if (result.rows[0].value.deleted)
//        {
//            console.log('A deletion was made. Attempting to redelete.');
//            db.get(docid).then(function (doc) {
//                doc._deleted = true;
//                return db.put(doc);
//            });
//        }
//    }).catch(function (err) {
//        console.log(err);
//    });
//}



// There was some form or error syncing
function syncError() {
}