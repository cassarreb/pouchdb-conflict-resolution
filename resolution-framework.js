//PouchDB instance
var db;

/**
    ResFramework Constructor. All fields should be set.
*/
function ResFramework() {
    this.onChangeCallback;
    this.onConflictCallback;
    this.dbName;
    this.remoteURL;
    this.options;
}

/**
    Initialisation function to create the PouchDB instance
    To use the init function,
    the dbName must have already been specified.
*/
ResFramework.prototype.init = function () {
    if (this.dbName != null) {
        db = new PouchDB(this.dbName);
        return true;
    }
    else {
        //Specify the PouchDB name.
        return false;
    }
}

/**
    Initialise a sync operation with the remote CouchDB server
*/
ResFramework.prototype.sync = function () {

    if (db != null) {
        if (this.remoteURL != null && this.options != null) {
            db.sync(this.remoteURL, this.options
            ).on('change', function (change) {
                this.onChangeCallback();
                //Change operation
            }).on('paused', function () {
                //DB Paused operation
            }).on('active', function () {
                //DB Active operaion
            }).on('error', function (err) {
                //DB error on sync 
            });
        }
        else {
            //RemoteURL and/or sync options object are null. 
        }
    }
    else {
        //PouchDB has not yet been initialised. init() function must be called.
    }
}

/**
    Initialises an on change listener on the PouchDB instance.
    Accepts an object of options which will customise the changes listener.
*/
ResFramework.prototype.initChangesListener = function (options) {

    var changeCB = this.onChangeCallback;
    var conflictCB = this.onConflictsCallback;

    db.changes(
        options
        ).on('change', function (info) {

            if (info.deleted) {
               //Delete was made
            } else {
                //Update was made

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

                            //An eventual update conflict has arisen and the conflict callback should be called
                            conflictCB(info.doc, conflict);
                            //info.doc is the entire chosen doc, conflict is just the conflicting rev num
                        }
                    }
                }

            }
            //Call the change callback after a change was made.
            changeCB();
        });
}

/**
    Database PUT operation.
    Accepts the document to be PUT and a callback function.
*/
ResFramework.prototype.put = function (doc, callback) {

    return new Promise(function (resolve, reject) {
        db.put(doc).then(function (response) {
            callback(doc, null, response).then(function () {
                resolve();
            }).catch(function () {
                reject();
            });

        }).catch(function (err) {
            callback(doc, err, null)
               .then(function () {
                   resolve();
               }).catch(function () {
                   reject();
               });
        });
    });
}


/**
    Database POST operation.
    Accepts the document to be POSTed and a callback function.
*/
ResFramework.prototype.post = function (doc, callback) {

    return new Promise(function (resolve, reject) {
        db.post(doc).then(function (response) {
            callback(doc, null, response).then(function () {
                resolve();
            }).catch(function () {
                reject();
            });

        }).catch(function (err) {
            callback(doc, err, null).then(function () {
                resolve();
            }).catch(function () {
                reject();
            });
        });
    });

}

/**
    INSERT - Immediate Conflict Resolution - Attempts to re-insert using a different ID
*/
function Insert_ReAttemptWithUUID(doc, err, result) {

    return new Promise(function (resolve, reject) {
        if (!err) {
            if (result && result.ok) {
                //Insert operation carried out successfully
                resolve();
            }
        }
        else {
            if (err.status === 409) {
                //Insert operation resulted in a conflict. Retry in progress.
                doc._id = null;
                this.fw.post(doc, Insert_NoReAttempt).then(function () {
                    resolve();
                }).catch(function () {
                    reject();
                });

            }
            else if (err.status === 412) {
                 //Missing ID. Retry in progress.
                doc._id = null;
                this.fw.post(doc, Insert_NoReAttempt)
                    .then(function () {
                        resolve();
                    }).catch(function () {
                        reject();
                    });
            } else {

                reject();
            }
        }
    });
}

/**
    INSERT - Immediate Conflict Resolution - Attempts no re-insert 
*/
function Insert_NoReAttempt(doc, err, result) {

    return new Promise(function (resolve, reject) {
        if (!err) {
            if (result && result.ok) {
               //Insert operation carried out successfully.
                resolve();
            }
        }
        else {
            if (err.status === 409) {
                //Insert operation resulted in a conflict - Error 409.
            }
            else if (err.status === 412) {
                //Missing ID
            }
            reject();
        }
    });
}

/**
    Update - Immediate update conflict - Attempt re-using new revision number
*/
function Update_NewRevisionNum(doc, err, response) {

    var _doc = doc;

    return new Promise(function (resolve, reject) {
        if (!err && response.ok) {
           //Update operation carried out successfully.
            resolve();
        }
        else {
            if (err.status === 409) {
                //Update operation resulted in a conflict
                db.get(_doc._id).then(function (doc) {
                    //Re-attempting update with new revision number
                    _doc._rev = doc._rev;
                    db.put(_doc).then(function (response) {
                        resolve();
                        //Success
                    }).catch(function (err) {
                        reject();
                        //Error
                    });
                }).catch(function (err) {
                    //Error
                    reject();
                });
            }
            else {

                reject();
            }
        }
    });
}

/**
    Update - Immediate update conflict - Don't re-attempt update
*/
function Update_NoReAttempt(doc, err, response) {
    return new Promise(function (resolve, reject) {
        if (err) {
            if (err.status === 409) {
                //Update operation resulted in a conflict. Update has been rejected.
                reject();
            }
            if (err.status === 412) {
                //Update operation resulted in a conflict due to missing ID. Update has been rejected.
                reject();
            }
        }

        resolve();
    });
}
/**
   Replication -  Eventual conflict - Agree with CouchDB's descision 
   Remove conflict from conflicts array.
*/
function EventualConflict_Accept(doc, err) {
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
    Replication -  Eventual conflict - Merge documents based on keys
    Choose arbitrary value from 2 keys which have both been modified.
    doc: the document declared as the winner by CouchDB
    conf: revision number of the conflicting document
*/
function EventualConflicts_Merge(doc, conf) {
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
                var result_orig_cho = {};
                var result_orig_rej = {};

                for (var p in original) {
                    if (original.hasOwnProperty(p)) {
                        if (chosen.hasOwnProperty(p)) {
                            if (original[p] == chosen[p]) {
                                //values are equal
                                result_orig_cho[p] = 0;
                            }
                            else {
                                //values not equal - change was done
                                result_orig_cho[p] = 1;
                            }
                        }

                        if (rejected.hasOwnProperty(p)) {
                            if (original[p] == rejected[p]) {
                                //values are equal
                                result_orig_rej[p] = 0;
                            }
                            else {
                                //values not equal - change was done
                                result_orig_rej[p] = 1;
                            }
                        }
                    }
                }

                for (var p in chosen) {
                    if (chosen.hasOwnProperty(p)) {
                        if (!original.hasOwnProperty(p)) {
                            //this property has been added to the chosen doc but was not in original
                            result_orig_cho[p] = 1;
                        }
                    }
                }

                for (var p in rejected) {
                    if (rejected.hasOwnProperty(p)) {
                        if (!original.hasOwnProperty(p)) {
                            //this property has been added to the rejected doc but was not in original
                            result_orig_rej[p] = 1;
                        }
                    }
                }

                var newdoc = {};
                //for each key in result_orig_cho
                for (var q in result_orig_cho) {
                    //if that key is also in result_orig_rej, compare the values
                    if (result_orig_rej[q]) {
                        if (result_orig_cho[q] == 0) {
                            if (result_orig_rej[q] == 0) {
                                //everything is like the original
                            }
                            else {
                                newdoc[q] = rejected[q];
                            }
                        }
                        else {
                            if (result_orig_rej[q] == 0) {
                                newdoc[q] = chosen[q];
                            }
                            else {
                                //need to pick arbitrary winner
                                newdoc[q] = chosen[q];
                            }
                        }
                    }
                    else {
                        //the key is in result_orig_cho but not in result_orig_rej
                        newdoc[q] = chosen[q];
                    }
                }

                //add what wasnt in cho but is in rej to new doc
                for (var q in result_orig_rej) {
                    if (result_orig_cho[q] == null) {
                        newdoc[q] = rejected[q];
                    }
                }
                
                fw.put(newdoc, Update_NewRevisionNum).then(function () {

                }).catch(function () { });

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


/**
    Replication -  Eventual conflict - Merge documents based on keys
    For keys where both versions have been modified, merge both versions into the new version.
    doc: the document declared as the winner by CouchDB
    conf: revision number of the conflicting document
*/
function EventualConflicts_MergeText(doc, conf) {
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
                var result_orig_cho = {};
                var result_orig_rej = {};

                for (var p in original) {
                    if (original.hasOwnProperty(p)) {
                        if (chosen.hasOwnProperty(p)) {
                            if (original[p] == chosen[p]) {
                                //values are equal
                                result_orig_cho[p] = 0;
                            }
                            else {
                                //values not equal - change was done
                                result_orig_cho[p] = 1;
                            }
                        }

                        if (rejected.hasOwnProperty(p)) {
                            if (original[p] == rejected[p]) {
                                //values are equal
                                result_orig_rej[p] = 0;
                            }
                            else {
                                //values not equal - change was done
                                result_orig_rej[p] = 1;
                            }
                        }
                    }
                }

                for (var p in chosen) {
                    if (chosen.hasOwnProperty(p)) {
                        if (!original.hasOwnProperty(p)) {
                            //this property has been added to the chosen doc but was not in original
                            result_orig_cho[p] = 1;
                        }
                    }
                }

                for (var p in rejected) {
                    if (rejected.hasOwnProperty(p)) {
                        if (!original.hasOwnProperty(p)) {
                            //this property has been added to the rejected doc but was not in original
                            result_orig_rej[p] = 1;
                        }
                    }
                }

                var newdoc = {};
                //for each key in result_orig_cho
                for (var q in result_orig_cho) {
                    //if that key is also in result_orig_rej, compare the values
                    if (result_orig_rej[q]) {
                        if (result_orig_cho[q] == 0) {
                            if (result_orig_rej[q] == 0) {
                                //everything is like the original
                            }
                            else {
                                newdoc[q] = rejected[q];
                            }
                        }
                        else {
                            if (result_orig_rej[q] == 0) {
                                newdoc[q] = chosen[q];
                            }
                            else {
                                //combine both versions
                                newdoc[q] = chosen[q] + ' ' + rejected[q];
                            }
                        }
                    }
                    else {
                        //the key is in result_orig_cho but not in result_orig_rej
                        newdoc[q] = chosen[q];
                    }
                }

                //add what wasnt in cho but is in rej to new doc
                for (var q in result_orig_rej) {
                    if (result_orig_cho[q] == null) {
                        newdoc[q] = rejected[q];
                    }
                }

                fw.put(newdoc, Update_NewRevisionNum).then(function () {
                
                }).catch(function() {});

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

//Second constructor
function ResFramework(dbName, remoteURL) {
    this.onChangeCallback;
    this.onConflictCallback;
    this.dbName = dbName;
    this.remoteURL = remoteURL;
    this.options;
}
