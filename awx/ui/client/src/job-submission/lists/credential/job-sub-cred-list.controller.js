/*************************************************
 * Copyright (c) 2017 Ansible, Inc.
 *
 * All Rights Reserved
 *************************************************/

export default
    [   '$scope',
        function($scope) {
            $scope.toggle_row = function(rowId) {
                let list = $scope.list;
                let count = 0;
                $scope[list.name].forEach(function(row) {
                    if (row.id === rowId) {
                        if (row.checked) {
                            row.success_class = 'success';
                        } else {
                            row.checked = true;
                            row.success_class = '';
                        }
                        $scope.$emit('credentialSelected', row);
                    } else {
                        row.checked = 0;
                        row.success_class = '';
                    }
                    if (row.checked) {
                        count++;
                    }
                });
            };
        }
    ];
