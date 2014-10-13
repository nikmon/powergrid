define(['override', 'jquery', 'promise'], function(override, $, Promise) {
    
    "use strict";
    
    // Adds treegrid functionality to the grid.
    // This works by wrapping the datasource in a TreeGridDataSource whose data can change
    // depending on which rows are collapsed or expanded.
    
    function TreeGridDataSource(delegate, options) {
        var self = this;
        
        this.options = options;
        
        if(!$.isArray(delegate)) {
            this.delegate = delegate;

            var proto = Object.getPrototypeOf(this.delegate);
            var selfProto = Object.getPrototypeOf(this);
            Object.keys(proto).forEach(function (member) {
                if (!selfProto[member] && (typeof proto[member] === "function")) {
                    selfProto[member] = function() {return proto[member].apply(this.delegate, arguments) }
                }
            });

            if(delegate.isReady()) {
                this.load();
            }

            $(delegate).on("dataloaded", this.load.bind(this));
        } else {
            this.tree = delegate;
            this.load();
        }

        $(this).on("dataloaded", function() {
            self.updateRecordByIdMap(this.getData());
        }).on("rowsadded", function(event, data) {
            self.updateRecordByIdMap(this.getData(data.start, data.end));
        });
    }

    TreeGridDataSource.prototype = {
        updateRecordByIdMap: function(data) {
            var self = this;
            data.forEach(function(row) {
                self.recordByIdMap[row.id] = row;
            })
        },

        treeSettings: function(row) {
            if (!this._treeSettings[row.id]) {
                var depth = this.parent(row) ? this._treeSettings[this.parent(row)].depth + 1 : 0;
                this._treeSettings[row.id] = {expanded: false, depth: depth};
            }
            return this._treeSettings[row.id];
        },

        isReady: function() {
            return this.view !== undefined;
        },
        
        assertReady: function() {
            if(!this.isReady()) {
                throw "Datasource not ready yet";
            }
        },
        
        load: function() {
            this._treeSettings = {};
            this.recordByIdMap = {};
            this.parentByIdMap = {};
            this.childrenByIdMap = {};

            if(this.delegate) {
                if (this.delegate.buildTree) {
                    this.tree = this.delegate.buildTree();
                } else {
                    this.tree = this.buildTree(this.delegate.getData());
                }
            }
            this.view = this.initView(this.tree, this.options && this.options.initialTreeDepth || 0);
            $(this).trigger("dataloaded");
        },
        
        initView: function(data, initialTreeDepth) {
            var view = [];
            var self = this;
            
            function calcDepth(nodes, depth) {
                nodes.forEach(function(x) {
                    self._treeSettings[x.id] = {depth: depth, expanded: depth < (initialTreeDepth || 0)};
                    if(depth <= (initialTreeDepth || 0)) {
                        view.push(x);
                        if (depth + 1 <= (initialTreeDepth || 0)) {
                            var children = self.children(x);
                            if(children && children.length) {
                                calcDepth(children, depth+1);
                            }
                        }
                    }
                });
            }
            
            calcDepth(data, 0);
            
            return view;
        },
        
        rebuildView: function(data) {
            return this.flattenSubTree(data);
        },
        
        buildTree: function(data) {
            var rootNodes = [];
            for(var x=0,l=data.length;x<l;x++) {
                var r = data[x];
                this.recordByIdMap[r.id] = r;
            }

            for(var x=0,l=data.length;x<l;x++) {
                var r = data[x];
                if(r.parent !== undefined) {
                    var parent = this.recordByIdMap[r.parent];
                    if(!parent.children) {
                        parent.children = [];   
                    }
                    parent.children.push(r);
                } else {
                    rootNodes.push(r);
                }
            }
            
            return rootNodes;
        },
        
        getRecordById: function(id) {
            return this.recordByIdMap[id];
        },
        
        getData: function(start, end) {
            this.assertReady();
            if(start !== undefined || end !== undefined) {
                return this.view.slice(start, end);
            } else {
                return this.view;
            }
        },
        
        recordCount: function() {
            this.assertReady();
            return this.view.length;
        },
        
        toggle: function(rowId) {
            var row = this.getRecordById(rowId);
            if(this.isExpanded(row)) {
                this.collapse(row);
            } else {
                this.expand(row);
            }
        },
        
        expand: function(row) {
            var rowId = row.id,l,x,start;
            
            if(this.isExpanded(row)) {
                // already expanded, don't do anything
                return;
            }

            // find the location of this row in the current view
            for(x=0,l=this.view.length; x<l; x++) {
                if(this.view[x].id == rowId) {
                    start = x;
                    break;
                }
            }
            
            // expand it. then we must insert rows
            this.treeSettings(row).expanded = true;
            if(start !== undefined) {
                var rows = this.flattenSubTree(row);
                this.view.splice.apply(this.view, [start+1, 0].concat(rows));
                $(this).trigger('rowsadded',{start: start+1, end: start+1 + rows.length});
            }
                        
            $(this).trigger('treetoggled', rowId, start, this.isExpanded(row));
        },
        
        collapse: function(row) {
            var rowId = row.id,x,l,start,end,startDepth;
            
            if(!this.isExpanded(row)) {
                // already expanded, don't do anything
                return;
            }
            
            for(x=0,l=this.view.length; x<l; x++) {
                if(start === undefined && this.view[x].id == rowId) {
                    startDepth = this.treeSettings(row).depth;
                    start = x;
                } else if(start !== undefined) {
                    if(this.treeSettings(this.view[x]).depth <= startDepth) {
                        break;
                    }
                }
            }
            
            end = x;

            // collapse it. we must remove some rows from the view.
            this.treeSettings(row).expanded = false;
            if(start !== undefined) {
                this.view.splice(start+1, end-start-1);
                $(this).trigger('rowsremoved',{start: start+1, end: end});
            }
                        
            $(this).trigger('treetoggled', rowId, start, this.isExpanded(row));
        },
        
        isExpanded: function(row) {
            return this.treeSettings(row).expanded;
        },
        
        expandAll: function(rowId) {
            var ds = this;
            function expandall(row) {
                var children = ds.children(row);
                if(children) {
                    children.forEach(expandall);
                }
                ds.expand(row);
            }
            
            if(rowId === undefined) {
                this.tree.forEach(expandall);
            } else {
                expandall(this.getRecordById(rowId));
            }
        },

        flattenSubTree: function(nodes, parentMatches) {
            var view = [],
                stack = [],
                self = this;
            
            function build(nodes, depth, parentExpanded, parentMatches) {
                for(var x=0,l=nodes.length;x<l;x++) {
                    var r = nodes[x], f = self.filter && self.filter(r), match = f == 0 ? parentMatches : f != -1;
                    
                    if(parentExpanded) {
                        while(stack.length > depth) stack.pop();
                        stack[depth] = r;
                    }
                    
                    if(match) {
                        view = view.concat(stack.filter(function(e) { return e; }));
                        for(var y=0;y<stack.length;y++) {
                            stack[y] = undefined;
                        }
                    }

                    if(f != -1 && self.hasChildren(r) && (self.treeSettings(r).expanded || (self.filter && !match))) {
                        var children = self.children(r);
                        build(children, depth + 1, self.treeSettings(r).expanded, match);
                    }
                }
            }
            
            var parentMatches = false;
            
            if(!$.isArray(nodes)) {
                var children = this.children(nodes);
                parentMatches = this.rowOrAncestorMatches(nodes);
                nodes = children;
            }
            
            if(nodes) build(nodes, 0, true, parentMatches);
            return view;
        },
        
        rowOrAncestorMatches: function(row) {
            return !this.filter || this.filter(row) || (this.parent(row) !== undefined && this.rowOrAncestorMatches(this.getRecordById(this.parent(row))));
        },
        
        sort: function(comparator) {
            var ds = this;
            function sort(arr) {
                arr.sort(comparator);
                for(var x=0,l=arr.length;x<l;x++) {
                    var children = ds.children(arr[x]);
                    if(children) {
                        sort(children);
                    }
                }
            }
            
            sort(this.tree);
            this.view = this.rebuildView(this.tree);
        },
        
        applyFilter: function(columnSettings, filterFunction) {
            this.filter = filterFunction;
            var oldView = this.view,
                view = this.view = this.rebuildView(this.tree);
            
            $(this).trigger('datachanged', { data: view, oldData: oldView });
        },

        hasChildren: function(row) {
            if (this.delegate && this.delegate.hasChildren) {
                return this.delegate.hasChildren.apply(this.delegate, arguments);
            }
            return row.children && row.children.length > 0;
        },

        children: function(row) {
            if (!this.childrenByIdMap[row.id]) {
                var children = row.children || this.delegate && typeof this.delegate.children === 'function' && this.delegate.children.apply(this.delegate, arguments);
                this.childrenByIdMap[row.id] = children;
                if(children !== undefined) {
                    for(var x=0,l=children.length;x<l;x++) {
                        this.parentByIdMap[children[x].id] = row.id;
                    }
                }
            }
            return this.childrenByIdMap[row.id];
        },

        parent: function(row) {
            if (this.delegate && this.delegate.parent) {
                return this.delegate.parent.apply(this.delegate, arguments);
            }
            return row.parent || this.parentByIdMap[row.id];
        }

    };
    
    return {
        loadFirst: ['templating', 'grouping'],
        init: function(grid, pluginOptions) {
            var treedepths = [],
                data,
                view;

            override(grid, function($super) {
                var treeDS;
                if(pluginOptions.autoTreeDataSource !== false) {
                    treeDS = new TreeGridDataSource(this.dataSource, pluginOptions);
                } else {
                    treeDS = this.dataSource;
                }

                return {
                    init: function() {
                        $super.init();

                        this.target.on("click", ".pg-treetoggle", function(event) {
                            var row = $(this).parents(".pg-row").first(),
                                rowId = row.attr("data-row-id");

                            treeDS.toggle(rowId);

                            event.stopPropagation();
                            event.preventDefault();
                        });

                        $(treeDS).on("treetoggled", function(event, rowId, rowIndex, newState) {
                            grid.target.find(".pg-row[data-row-id='" + rowId + "']").toggleClass("pg-tree-expanded", newState);
                        });
                    },

                    renderCellContent: function(record, rowIdx, column, value) {
                        var content = $super.renderCellContent.apply(this, arguments);
                        if(column.treeColumn) {
                            return $('<div>')
                                .addClass((this.dataSource.hasChildren(record)) ? "pg-treetoggle" : "pg-treeleaf")
                                .addClass('pg-tree-level-' + this.dataSource.treeSettings(record).depth)
                                .toggleClass("pg-tree-expanded", this.dataSource.treeSettings(record).expanded)
                                .add(content);
                        } else {
                            return content;
                        }
                    },

                    dataSource: treeDS
                }
            });
        },
        
        TreeGridDataSource: TreeGridDataSource
    };
    
});