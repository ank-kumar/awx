/*************************************************
 * Copyright (c) 2016 Ansible, Inc.
 *
 * All Rights Reserved
 *************************************************/

export default ['$scope', 'TemplatesService',
    'ProcessErrors', 'CreateSelect2', '$q', 'JobTemplateModel',
    'Empty', 'PromptService', 'Rest', 'TemplatesStrings', 'WorkflowChartService',
    'Wait', '$state',
    function ($scope, TemplatesService,
        ProcessErrors, CreateSelect2, $q, JobTemplate,
        Empty, PromptService, Rest, TemplatesStrings, WorkflowChartService,
        Wait, $state
    ) {

        let deletedNodeIds = [];
        let workflowMakerNodeIdCounter;
        let nodeIdToChartNodeIdMapping = {};
        let nodeRef = {};
        let allNodes = [];
        let page = 1;

        $scope.strings = TemplatesStrings;
        $scope.preventCredsWithPasswords = true;
        $scope.showKey = false;
        $scope.toggleKey = () => $scope.showKey = !$scope.showKey;
        $scope.keyClassList = `{ 'Key-menuIcon--active': showKey }`;
        $scope.readOnly = !_.get($scope, 'workflowJobTemplateObj.summary_fields.user_capabilities.edit');
        $scope.formState = {
            'showNodeForm': false,
            'showLinkForm': false
        };

        let getNodes = () => {
            Wait('start');
            TemplatesService.getWorkflowJobTemplateNodes($scope.workflowJobTemplateObj.id, page)
                .then(({data}) => {
                    for (let i = 0; i < data.results.length; i++) {
                        allNodes.push(data.results[i]);
                    }
                    if (data.next) {
                        // Get the next page
                        page++;
                        getNodes();
                    } else {
                        let arrayOfLinksForChart = [];
                        let arrayOfNodesForChart = [];

                        ({arrayOfNodesForChart, arrayOfLinksForChart, nodeIdToChartNodeIdMapping, nodeRef, workflowMakerNodeIdCounter} = WorkflowChartService.generateArraysOfNodesAndLinks(allNodes));

                        $scope.graphState = { arrayOfNodesForChart, arrayOfLinksForChart };

                        Wait('stop');
                    }
                }, ({ data, status, config }) => {
                    Wait('stop');
                    ProcessErrors($scope, data, status, null, {
                        hdr: $scope.strings.get('error.HEADER'),
                        msg: $scope.strings.get('error.CALL', {
                            path: `${config.url}`,
                            action: `${config.method}`,
                            status
                        })
                    });
                });
        };

        getNodes();

        $scope.saveWorkflowMaker = () => {

            Wait('start');

            let buildSendableNodeData = (node) => {
                // Create the node
                let sendableNodeData = {
                    extra_data: {},
                    inventory: null,
                    job_type: null,
                    job_tags: null,
                    skip_tags: null,
                    limit: null,
                    diff_mode: null,
                    verbosity: null,
                    credential: null
                };

                if (_.has(node, 'fullUnifiedJobTemplateObject')) {
                    sendableNodeData.unified_job_template = node.fullUnifiedJobTemplateObject.id;
                }

                if (_.has(node, 'promptData.extraVars')) {
                    if (_.get(node, 'promptData.launchConf.defaults.extra_vars')) {
                        const defaultVars = jsyaml.safeLoad(node.promptData.launchConf.defaults.extra_vars);

                        // Only include extra vars that differ from the template default vars
                        _.forOwn(node.promptData.extraVars, (value, key) => {
                            if (!defaultVars[key] || defaultVars[key] !== value) {
                                sendableNodeData.extra_data[key] = value;
                            }
                        });
                        if (_.isEmpty(sendableNodeData.extra_data)) {
                            delete sendableNodeData.extra_data;
                        }
                    } else {
                        if (_.has(node, 'promptData.extraVars') && !_.isEmpty(node.promptData.extraVars)) {
                            sendableNodeData.extra_data = node.promptData.extraVars;
                        }
                    }
                }

                // Check to see if the user has provided any prompt values that are different
                // from the defaults in the job template

                if (_.has(node, 'fullUnifiedJobTemplateObject') &&
                    (node.fullUnifiedJobTemplateObject.type === "workflow_job_template" ||
                    node.fullUnifiedJobTemplateObject.type === "job_template") && 
                    node.promptData
                ) {
                    sendableNodeData = PromptService.bundlePromptDataForSaving({
                        promptData: node.promptData,
                        dataToSave: sendableNodeData
                    });
                }

                return sendableNodeData;
            };

            if ($scope.graphState.arrayOfNodesForChart.length > 1) {
                let addPromises = [];
                let editPromises = [];
                let credentialRequests = [];

                Object.keys(nodeRef).map((workflowMakerNodeId) => {
                    if (nodeRef[workflowMakerNodeId].isNew) {
                        addPromises.push(TemplatesService.addWorkflowNode({
                            url: $scope.workflowJobTemplateObj.related.workflow_nodes,
                            data: buildSendableNodeData(nodeRef[workflowMakerNodeId])
                        }).then(({data}) => {
                            nodeRef[workflowMakerNodeId].originalNodeObject = data;
                            nodeIdToChartNodeIdMapping[data.id] = parseInt(workflowMakerNodeId);
                            if (_.get(nodeRef[workflowMakerNodeId], 'promptData.launchConf.ask_credential_on_launch')) {
                                // This finds the credentials that were selected in the prompt but don't occur
                                // in the template defaults
                                let credentialIdsToPost = nodeRef[workflowMakerNodeId].promptData.prompts.credentials.value.filter((credFromPrompt) => {
                                    let defaultCreds = _.get(nodeRef[workflowMakerNodeId], 'promptData.launchConf.defaults.credentials', []);
                                    return !defaultCreds.some((defaultCred) => {
                                        return credFromPrompt.id === defaultCred.id;
                                    });
                                });

                                credentialIdsToPost.forEach((credentialToPost) => {
                                    credentialRequests.push({
                                        id: data.id,
                                        data: {
                                            id: credentialToPost.id
                                        }
                                    });
                                });
                            }
                        }));
                    } else if (nodeRef[workflowMakerNodeId].isEdited) {
                        editPromises.push(TemplatesService.editWorkflowNode({
                            id: nodeRef[workflowMakerNodeId].originalNodeObject.id,
                            data: buildSendableNodeData(nodeRef[workflowMakerNodeId])
                        }));

                        if (_.get(nodeRef[workflowMakerNodeId], 'promptData.launchConf.ask_credential_on_launch')) {
                            let credentialsNotInPriorCredentials = nodeRef[workflowMakerNodeId].promptData.prompts.credentials.value.filter((credFromPrompt) => {
                                let defaultCreds = _.get(nodeRef[workflowMakerNodeId], 'promptData.launchConf.defaults.credentials', []);
                                return !defaultCreds.some((defaultCred) => {
                                    return credFromPrompt.id === defaultCred.id;
                                });
                            });

                            let credentialsToAdd = credentialsNotInPriorCredentials.filter((credNotInPrior) => {
                                let previousOverrides = _.get(nodeRef[workflowMakerNodeId], 'promptData.prompts.credentials.previousOverrides', []);
                                return !previousOverrides.some((priorCred) => {
                                    return credNotInPrior.id === priorCred.id;
                                });
                            });

                            let credentialsToRemove = [];

                            if (_.has(nodeRef[workflowMakerNodeId], 'promptData.prompts.credentials.previousOverrides')) {
                                credentialsToRemove = nodeRef[workflowMakerNodeId].promptData.prompts.credentials.previousOverrides.filter((priorCred) => {
                                    return !credentialsNotInPriorCredentials.some((credNotInPrior) => {
                                        return priorCred.id === credNotInPrior.id;
                                    });
                                });
                            }

                            credentialsToAdd.forEach((credentialToAdd) => {
                                credentialRequests.push({
                                    id: nodeRef[workflowMakerNodeId].originalNodeObject.id,
                                    data: {
                                        id: credentialToAdd.id
                                    }
                                });
                            });

                            credentialsToRemove.forEach((credentialToRemove) => {
                                credentialRequests.push({
                                    id: nodeRef[workflowMakerNodeId].originalNodeObject.id,
                                    data: {
                                        id: credentialToRemove.id,
                                        disassociate: true
                                    }
                                });
                            });
                        }
                    }

                });

                let deletePromises = deletedNodeIds.map((nodeId) => {
                    return TemplatesService.deleteWorkflowJobTemplateNode(nodeId);
                });

                $q.all(addPromises.concat(editPromises, deletePromises))
                    .then(() => {
                        let disassociatePromises = [];
                        let associatePromises = [];
                        let linkMap = {};

                        // Build a link map for easy access
                        $scope.graphState.arrayOfLinksForChart.forEach(link => {
                            // link.source.id of 1 is our artificial start node
                            if (link.source.id !== 1) {
                                const sourceNodeId = nodeRef[link.source.id].originalNodeObject.id;
                                const targetNodeId = nodeRef[link.target.id].originalNodeObject.id;
                                if (!linkMap[sourceNodeId]) {
                                    linkMap[sourceNodeId] = {};
                                }

                                linkMap[sourceNodeId][targetNodeId] = link.edgeType;
                            }
                        });

                        Object.keys(nodeRef).map((workflowNodeId) => {
                            let nodeId = nodeRef[workflowNodeId].originalNodeObject.id;
                            if (nodeRef[workflowNodeId].originalNodeObject.success_nodes) {
                                nodeRef[workflowNodeId].originalNodeObject.success_nodes.forEach((successNodeId) => {
                                    if (
                                        !deletedNodeIds.includes(successNodeId) &&
                                        (!linkMap[nodeId] ||
                                        !linkMap[nodeId][successNodeId] ||
                                        linkMap[nodeId][successNodeId] !== "success")
                                    ) {
                                        disassociatePromises.push(
                                            TemplatesService.disassociateWorkflowNode({
                                                parentId: nodeId,
                                                nodeId: successNodeId,
                                                edge: "success"
                                            })
                                        );
                                    }
                                });
                            }
                            if (nodeRef[workflowNodeId].originalNodeObject.failure_nodes) {
                                nodeRef[workflowNodeId].originalNodeObject.failure_nodes.forEach((failureNodeId) => {
                                    if (
                                        !deletedNodeIds.includes(failureNodeId) &&
                                        (!linkMap[nodeId] ||
                                        !linkMap[nodeId][failureNodeId] ||
                                        linkMap[nodeId][failureNodeId] !== "failure")
                                    ) {
                                        disassociatePromises.push(
                                            TemplatesService.disassociateWorkflowNode({
                                                parentId: nodeId,
                                                nodeId: failureNodeId,
                                                edge: "failure"
                                            })
                                        );
                                    }
                                });
                            }
                            if (nodeRef[workflowNodeId].originalNodeObject.always_nodes) {
                                nodeRef[workflowNodeId].originalNodeObject.always_nodes.forEach((alwaysNodeId) => {
                                    if (
                                        !deletedNodeIds.includes(alwaysNodeId) &&
                                        (!linkMap[nodeId] ||
                                        !linkMap[nodeId][alwaysNodeId] ||
                                        linkMap[nodeId][alwaysNodeId] !== "always")
                                    ) {
                                        disassociatePromises.push(
                                            TemplatesService.disassociateWorkflowNode({
                                                parentId: nodeId,
                                                nodeId: alwaysNodeId,
                                                edge: "always"
                                            })
                                        );
                                    }
                                });
                            }
                        });

                        Object.keys(linkMap).map((sourceNodeId) => {
                            Object.keys(linkMap[sourceNodeId]).map((targetNodeId) => {
                                const sourceChartNodeId = nodeIdToChartNodeIdMapping[sourceNodeId];
                                const targetChartNodeId = nodeIdToChartNodeIdMapping[targetNodeId];
                                switch(linkMap[sourceNodeId][targetNodeId]) {
                                    case "success":
                                        if (
                                            !nodeRef[sourceChartNodeId].originalNodeObject.success_nodes ||
                                            !nodeRef[sourceChartNodeId].originalNodeObject.success_nodes.includes(nodeRef[targetChartNodeId].originalNodeObject.id)
                                        ) {
                                            associatePromises.push(
                                                TemplatesService.associateWorkflowNode({
                                                    parentId: parseInt(sourceNodeId),
                                                    nodeId: parseInt(targetNodeId),
                                                    edge: "success"
                                                })
                                            );
                                        }
                                        break;
                                    case "failure":
                                        if (
                                            !nodeRef[sourceChartNodeId].originalNodeObject.failure_nodes ||
                                            !nodeRef[sourceChartNodeId].originalNodeObject.failure_nodes.includes(nodeRef[targetChartNodeId].originalNodeObject.id)
                                        ) {
                                            associatePromises.push(
                                                TemplatesService.associateWorkflowNode({
                                                    parentId: parseInt(sourceNodeId),
                                                    nodeId: parseInt(targetNodeId),
                                                    edge: "failure"
                                                })
                                            );
                                        }
                                        break;
                                    case "always":
                                        if (
                                            !nodeRef[sourceChartNodeId].originalNodeObject.always_nodes ||
                                            !nodeRef[sourceChartNodeId].originalNodeObject.always_nodes.includes(nodeRef[targetChartNodeId].originalNodeObject.id)
                                        ) {
                                            associatePromises.push(
                                                TemplatesService.associateWorkflowNode({
                                                    parentId: parseInt(sourceNodeId),
                                                    nodeId: parseInt(targetNodeId),
                                                    edge: "always"
                                                })
                                            );
                                        }
                                        break;
                                }
                            });
                        });

                        $q.all(disassociatePromises)
                            .then(() => {
                                let credentialPromises = credentialRequests.map((request) => {
                                    return TemplatesService.postWorkflowNodeCredential({
                                        id: request.id,
                                        data: request.data
                                    });
                                });

                                return $q.all(associatePromises.concat(credentialPromises))
                                    .then(() => {
                                        Wait('stop');
                                        $scope.closeDialog();
                                    });
                            }).catch(({
                                data,
                                status
                            }) => {
                                Wait('stop');
                                ProcessErrors($scope, data, status, null, {});
                            });
                    });

            } else {

                let deletePromises = deletedNodeIds.map((nodeId) => {
                    return TemplatesService.deleteWorkflowJobTemplateNode(nodeId);
                });

                $q.all(deletePromises)
                    .then(() => {
                        Wait('stop');
                        $scope.closeDialog();
                        $state.transitionTo('templates');
                    });
            }
        };

        /* ADD NODE FUNCTIONS */

        $scope.startAddNodeWithoutChild = (parent) => {
            if ($scope.nodeConfig) {
                $scope.cancelNodeForm();
            }

            if ($scope.linkConfig) {
                $scope.cancelLinkForm();
            }

            $scope.graphState.arrayOfNodesForChart.push({
                id: workflowMakerNodeIdCounter,
                unifiedJobTemplate: null
            });

            $scope.graphState.nodeBeingAdded = workflowMakerNodeIdCounter;

            $scope.graphState.arrayOfLinksForChart.push({
                source: {id: parent.id},
                target: {id: workflowMakerNodeIdCounter},
                edgeType: "placeholder"
            });

            $scope.nodeConfig = {
                mode: "add",
                nodeId: workflowMakerNodeIdCounter,
                newNodeIsRoot: parent.id === 1
            };

            workflowMakerNodeIdCounter++;

            $scope.$broadcast("refreshWorkflowChart");

            $scope.formState.showNodeForm = true;
        };

        $scope.startAddNodeWithChild = (link) => {
            if ($scope.nodeConfig) {
                $scope.cancelNodeForm();
            }

            if ($scope.linkConfig) {
                $scope.cancelLinkForm();
            }

            $scope.graphState.arrayOfNodesForChart.push({
                id: workflowMakerNodeIdCounter,
                unifiedJobTemplate: null
            });

            $scope.graphState.nodeBeingAdded = workflowMakerNodeIdCounter;

            $scope.graphState.arrayOfLinksForChart.push({
                source: {id: link.source.id},
                target: {id: workflowMakerNodeIdCounter},
                edgeType: "placeholder"
            });

            $scope.nodeConfig = {
                mode: "add",
                nodeId: workflowMakerNodeIdCounter,
                newNodeIsRoot: link.source.id === 1
            };

            // Search for the link that used to exist between source and target and shift it to
            // go from our new node to the target
            $scope.graphState.arrayOfLinksForChart.forEach((linkToCompare) => {
                if (linkToCompare.source.id === link.source.id && linkToCompare.target.id === link.target.id) {
                    linkToCompare.source = {id: workflowMakerNodeIdCounter};
                }
            });

            workflowMakerNodeIdCounter++;

            $scope.$broadcast("refreshWorkflowChart");

            $scope.formState.showNodeForm = true;
        };

        $scope.confirmNodeForm = (selectedTemplate, promptData, edgeType) => {
            const nodeId = $scope.nodeConfig.nodeId;
            if ($scope.nodeConfig.mode === "add") {
                if (selectedTemplate && edgeType && edgeType.value) {
                    nodeRef[$scope.nodeConfig.nodeId] = {
                        fullUnifiedJobTemplateObject: selectedTemplate,
                        promptData,
                        isNew: true
                    };

                    $scope.graphState.nodeBeingAdded = null;

                    $scope.graphState.arrayOfLinksForChart.map( (link) => {
                        if (link.target.id === nodeId) {
                            link.edgeType = edgeType.value;
                        }
                    });
                }
            } else if ($scope.nodeConfig.mode === "edit") {
                if (selectedTemplate) {
                    nodeRef[$scope.nodeConfig.nodeId].fullUnifiedJobTemplateObject = selectedTemplate;
                    nodeRef[$scope.nodeConfig.nodeId].promptData = _.cloneDeep(promptData);
                    nodeRef[$scope.nodeConfig.nodeId].isEdited = true;
                    $scope.graphState.nodeBeingEdited = null;
                }
            }

            $scope.graphState.arrayOfNodesForChart.map( (node) => {
                if (node.id === nodeId) {
                    node.unifiedJobTemplate = selectedTemplate;
                }
            });

            $scope.formState.showNodeForm = false;
            $scope.nodeConfig = null;

            $scope.$broadcast("refreshWorkflowChart");
        };

        $scope.cancelNodeForm = () => {
            const nodeId = $scope.nodeConfig.nodeId;
            if ($scope.nodeConfig.mode === "add") {
                // Remove the placeholder node from the array
                for( let i = $scope.graphState.arrayOfNodesForChart.length; i--; ){
                    if ($scope.graphState.arrayOfNodesForChart[i].id === nodeId) {
                        $scope.graphState.arrayOfNodesForChart.splice(i, 1);
                        i = 0;
                    }
                }

                // Update the links
                let parents = [];
                let children = [];

                // Remove any links that reference this node
                for( let i = $scope.graphState.arrayOfLinksForChart.length; i--; ){
                    const link = $scope.graphState.arrayOfLinksForChart[i];

                    if (link.source.id === nodeId || link.target.id === nodeId) {
                        if (link.source.id === nodeId) {
                            children.push({id: link.target.id, edgeType: link.edgeType});
                        } else if (link.target.id === nodeId) {
                            parents.push(link.source.id);
                        }
                        $scope.graphState.arrayOfLinksForChart.splice(i, 1);
                    }
                }

                // Add the new links
                parents.forEach((parentId) => {
                    children.forEach((child) => {
                        let source = {
                            id: parentId
                        };
                        if (parentId === 1) {
                            child.edgeType = "always";
                        }
                        $scope.graphState.arrayOfLinksForChart.push({
                            source,
                            target: {id: child.id},
                            edgeType: child.edgeType
                        });
                    });
                });

            } else if ($scope.nodeConfig.mode === "edit") {
                $scope.graphState.nodeBeingEdited = null;
            }
            $scope.formState.showNodeForm = false;
            $scope.nodeConfig = null;
            $scope.$broadcast("refreshWorkflowChart");
        };

        /* EDIT NODE FUNCTIONS */

        $scope.startEditNode = (nodeToEdit) => {
            if ($scope.linkConfig) {
                $scope.cancelLinkForm();
            }

            if (!$scope.nodeConfig || ($scope.nodeConfig && $scope.nodeConfig.nodeId !== nodeToEdit.id)) {
                if ($scope.nodeConfig) {
                    $scope.cancelNodeForm();
                }

                $scope.nodeConfig = {
                    mode: "edit",
                    nodeId: nodeToEdit.id,
                    node: nodeRef[nodeToEdit.id]
                };

                $scope.graphState.nodeBeingEdited = nodeToEdit.id;

                $scope.formState.showNodeForm = true;
            }

            $scope.$broadcast("refreshWorkflowChart");
        };

        /* LINK FUNCTIONS */

        $scope.startEditLink = (linkToEdit) => {
            const setupLinkEdit = () => {

                // Determine whether or not this link can be removed
                let numberOfParents = 0;
                $scope.graphState.arrayOfLinksForChart.forEach((link) => {
                    if (link.target.id === linkToEdit.target.id) {
                        numberOfParents++;
                    }
                });

                $scope.graphState.linkBeingEdited = {
                    source: linkToEdit.source.id,
                    target: linkToEdit.target.id
                };

                $scope.linkConfig = {
                    mode: "edit",
                    source: {
                        id: linkToEdit.source.id,
                        name: _.get(linkToEdit, 'source.unifiedJobTemplate.name') || ""
                    },
                    target: {
                        id: linkToEdit.target.id,
                        name: _.get(linkToEdit, 'target.unifiedJobTemplate.name') || ""
                    },
                    edgeType: linkToEdit.edgeType,
                    canUnlink: numberOfParents > 1
                };
                $scope.formState.showLinkForm = true;

                $scope.$broadcast("refreshWorkflowChart");
            };

            if ($scope.nodeConfig) {
                $scope.cancelNodeForm();
            }

            if ($scope.linkConfig) {
                if ($scope.linkConfig.source.id !== linkToEdit.source.id || $scope.linkConfig.target.id !== linkToEdit.target.id) {
                    // User is going from editing one link to editing another
                    if ($scope.linkConfig.mode === "add") {
                        $scope.graphState.arrayOfLinksForChart.splice($scope.graphState.arrayOfLinksForChart.length-1, 1);
                    }
                    setupLinkEdit();
                }
            } else {
                setupLinkEdit();
            }

        };

        $scope.selectNodeForLinking = (node) => {
            if ($scope.nodeConfig) {
                $scope.cancelNodeForm();
            }
            // User was add/editing a link and then hit the link icon
            if ($scope.linkConfig && $scope.linkConfig.target) {
                $scope.cancelLinkForm();
            }
            if ($scope.linkConfig) {
                // This is the second node selected
                $scope.linkConfig.target = {
                    id: node.id,
                    name: node.unifiedJobTemplate.name
                };
                $scope.linkConfig.edgeType = "success";

                $scope.graphState.arrayOfNodesForChart.forEach((nodeToUpdate) => {
                    nodeToUpdate.isInvalidLinkTarget = false;
                });

                $scope.graphState.arrayOfLinksForChart.push({
                    source: {id: $scope.linkConfig.source.id},
                    target: {id: node.id},
                    edgeType: "placeholder"
                });

                $scope.graphState.linkBeingEdited = {
                    source: {id: $scope.linkConfig.source.id},
                    target: {id: node.id}
                };

                $scope.graphState.arrayOfLinksForChart.forEach((link, index) => {
                    if (link.source.id === 1 && link.target.id === node.id) {
                        $scope.graphState.arrayOfLinksForChart.splice(index, 1);
                    }
                });

                $scope.graphState.isLinkMode = false;
            } else {
                // This is the first node selected
                $scope.graphState.addLinkSource = node.id;
                $scope.linkConfig = {
                    mode: "add",
                    source: {
                        id: node.id,
                        name: node.unifiedJobTemplate.name
                    }
                };

                let parentMap = {};
                let invalidLinkTargetIds = [];

                // Find and mark any ancestors as disabled to prevent cycles
                $scope.graphState.arrayOfLinksForChart.forEach((link) => {
                    // id=1 is our artificial root node so we don't care about that
                    if (link.source.id !== 1) {
                        if (link.source.id === node.id) {
                            // Disables direct children from the add link process
                            invalidLinkTargetIds.push(link.target.id);
                        }
                        if (!parentMap[link.target.id]) {
                            parentMap[link.target.id] = [];
                        }
                        parentMap[link.target.id].push(link.source.id);
                    }
                });

                let getAncestors = (id) => {
                    if (parentMap[id]) {
                        parentMap[id].forEach((parentId) => {
                            invalidLinkTargetIds.push(parentId);
                            getAncestors(parentId);
                        });
                    }
                };

                getAncestors(node.id);

                // Filter out the duplicates
                invalidLinkTargetIds.filter((element, index, array) => index === array.indexOf(element)).forEach((ancestorId) => {
                    $scope.graphState.arrayOfNodesForChart.forEach((node) => {
                        if (node.id === ancestorId) {
                            node.isInvalidLinkTarget = true;
                        }
                    });
                });

                $scope.graphState.isLinkMode = true;

                $scope.formState.showLinkForm = true;
            }

            $scope.$broadcast("refreshWorkflowChart");
        };

        $scope.confirmLinkForm = (newEdgeType) => {
            $scope.graphState.arrayOfLinksForChart.forEach((link) => {
                if (link.source.id === $scope.linkConfig.source.id && link.target.id === $scope.linkConfig.target.id) {
                    link.edgeType = newEdgeType;
                }
            });

            if ($scope.linkConfig.mode === "add") {
                $scope.graphState.arrayOfNodesForChart.forEach((node) => {
                    node.isInvalidLinkTarget = false;
                });
            }

            $scope.graphState.linkBeingEdited = null;
            $scope.graphState.addLinkSource = null;
            $scope.formState.showLinkForm = false;
            $scope.linkConfig = null;
            $scope.$broadcast("refreshWorkflowChart");
        };

        $scope.unlink = () => {
            // Remove the link
            for( let i = $scope.graphState.arrayOfLinksForChart.length; i--; ){
                const link = $scope.graphState.arrayOfLinksForChart[i];

                if (link.source.id === $scope.linkConfig.source.id && link.target.id === $scope.linkConfig.target.id) {
                    $scope.graphState.arrayOfLinksForChart.splice(i, 1);
                }
            }

            $scope.formState.showLinkForm = false;
            $scope.linkConfig = null;
            $scope.$broadcast("refreshWorkflowChart");
        };

        $scope.cancelLinkForm = () => {
            if ($scope.linkConfig.mode === "add" && $scope.linkConfig.target) {
                $scope.graphState.arrayOfLinksForChart.splice($scope.graphState.arrayOfLinksForChart.length-1, 1);
                let targetIsOrphaned = true;
                $scope.graphState.arrayOfLinksForChart.forEach((link) => {
                    if (link.target.id === $scope.linkConfig.target.id) {
                        targetIsOrphaned = false;
                    }
                });
                if (targetIsOrphaned) {
                    // Link it to the start node
                    $scope.graphState.arrayOfLinksForChart.push({
                        source: {id: 1},
                        target: {id: $scope.linkConfig.target.id},
                        edgeType: "always"
                    });
                }
            }
            $scope.graphState.linkBeingEdited = null;
            $scope.graphState.addLinkSource = null;
            $scope.graphState.isLinkMode = false;
            $scope.graphState.arrayOfNodesForChart.forEach((node) => {
                node.isInvalidLinkTarget = false;
            });
            $scope.formState.showLinkForm = false;
            $scope.linkConfig = null;
            $scope.$broadcast("refreshWorkflowChart");
        };

        /* DELETE NODE FUNCTIONS */

        $scope.startDeleteNode = (nodeToDelete) => {
            $scope.nodeToBeDeleted = nodeToDelete;
            $scope.deleteOverlayVisible = true;
        };

        $scope.cancelDeleteNode = () => {
            $scope.nodeToBeDeleted = null;
            $scope.deleteOverlayVisible = false;
        };

        $scope.confirmDeleteNode = () => {
            if ($scope.nodeToBeDeleted) {
                const nodeId = $scope.nodeToBeDeleted.id;

                if ($scope.linkConfig) {
                    $scope.cancelLinkForm();
                }

                // Remove the node from the array
                for( let i = $scope.graphState.arrayOfNodesForChart.length; i--; ){
                    if ($scope.graphState.arrayOfNodesForChart[i].id === nodeId) {
                        $scope.graphState.arrayOfNodesForChart.splice(i, 1);
                        i = 0;
                    }
                }

                // Update the links
                let parents = [];
                let children = [];
                let linkParentMapping = {};

                // Remove any links that reference this node
                for( let i = $scope.graphState.arrayOfLinksForChart.length; i--; ){
                    const link = $scope.graphState.arrayOfLinksForChart[i];

                    if (!linkParentMapping[link.target.id]) {
                        linkParentMapping[link.target.id] = [];
                    }

                    linkParentMapping[link.target.id].push(link.source.id);

                    if (link.source.id === nodeId || link.target.id === nodeId) {
                        if (link.source.id === nodeId) {
                            children.push({id: link.target.id, edgeType: link.edgeType});
                        } else if (link.target.id === nodeId) {
                            parents.push(link.source.id);
                        }
                        $scope.graphState.arrayOfLinksForChart.splice(i, 1);
                    }
                }

                // Add the new links
                parents.forEach((parentId) => {
                    children.forEach((child) => {
                        if (parentId === 1) {
                            // We only want to create a link from the start node to this node if it
                            // doesn't have any other parents
                            if(linkParentMapping[child.id].length === 1) {
                                $scope.graphState.arrayOfLinksForChart.push({
                                    source: {id: parentId},
                                    target: {id: child.id},
                                    edgeType: "always"
                                });
                            }
                        } else {
                            // We don't want to add a link that already exists
                            if (!linkParentMapping[child.id].includes(parentId)) {
                                $scope.graphState.arrayOfLinksForChart.push({
                                    source: {id: parentId},
                                    target: {id: child.id},
                                    edgeType: child.edgeType
                                });
                            }
                        }

                    });
                });

                if (nodeRef[$scope.nodeToBeDeleted.id].isNew !== true) {
                    deletedNodeIds.push(nodeRef[$scope.nodeToBeDeleted.id].originalNodeObject.id);
                }

                delete nodeRef[$scope.nodeToBeDeleted.id];

                $scope.deleteOverlayVisible = false;

                $scope.nodeToBeDeleted = null;
                $scope.deleteOverlayVisible = false;

                $scope.$broadcast("refreshWorkflowChart");
            }

        };

        $scope.toggleManualControls = () => {
            $scope.showManualControls = !$scope.showManualControls;
        };

        $scope.panChart = (direction) => {
            $scope.$broadcast('panWorkflowChart', {
                direction: direction
            });
        };

        $scope.zoomChart = (zoom) => {
            $scope.$broadcast('zoomWorkflowChart', {
                zoom: zoom
            });
        };

        $scope.resetChart = () => {
            $scope.$broadcast('resetWorkflowChart');
        };

        $scope.workflowZoomed = (zoom) => {
            $scope.$broadcast('workflowZoomed', {
                zoom: zoom
            });
        };

        $scope.zoomToFitChart = () => {
            $scope.$broadcast('zoomToFitChart');
        };
    }
];
