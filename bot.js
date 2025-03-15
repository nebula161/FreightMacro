// Freightbot by Nebula/Raeders
// Essentially an updated & upgraded version of Explorer.js by skubcat. Uses A* to calculate your boating route
// Thanks skubcat!

// Start next to a node!
const version = "beta 1.0"
const debug = true
function main() {
    let user = Player.getPlayer() // typing "Player.getPlayer() is not fun.
    if (user.getVehicle() == null) {
        Chat.log("§l§4Get into a boat before starting the boat bot!") // warns against not being in a boat, which currently has no error detection.
    } else {

        let freightData = undefined
        // get freight nodes
        let host = "https://raw.githubusercontent.com/nebula161/FreightMacro/refs/heads/main/freight_nodes.json"
        let importRequest = Request.get(`${host}`)
        try {
            if (importRequest.responseCode == 200) {
                freightData = JSON.parse(importRequest.text())
            }
        } catch (err) {
            Chat.log(`§4§l Error getting node data:\n${err.stack}`)
        }

        const destinationNode = "blue-cove"
        const cancelButton = "key.keyboard.s"

        if (debug) {
            freightData = JSON.parse(FS.open("freightnodes/freight_nodes.json").read())
        }
        
        // Skubcat movement code. Credit to them
        let boatPos = {
            x: user.getVehicle().getX(),
            z: user.getVehicle().getZ()
        } // After warning, init boat values

        let destinationPos = {
            x: 0,
            z: 0
        } // set your destination here. this will be replaced later with a GUI

        let boatAngle = user.getVehicle().getYaw()
        if (boatAngle < 0) boatAngle = 360 + boatAngle;

        const destTolerance = 2.5 // square around the destination where the boat will search for the next waypoint. Default Value is 2.5

        let chatOpen = false;

        JsMacros.on("OpenScreen", JavaWrapper.methodToJava(ev => {
            chatOpen = ev.screenName == "Chat";
        }));

        function vecToAngle(x1, z1, x2, z2) {
            var dz = z2 - z1;
            var dx = x2 - x1;
            var theta = Math.atan2(dz, dx);
            theta *= 180 / Math.PI; // rads to degs, range (-180, 180] <--- dont use these unless we need degrees for any reason. Remove if unessecary.
            theta -= 90
            if (theta < 0) theta = 360 + theta; // range [0, 360)
            return theta;
        }

        function left() {
            KeyBind.keyBind("key.left", true); // this is probably a terrible way of doing this, this should be fixed later.
            // (it isn't, this is fine)
            Client.waitTick(1)
            KeyBind.keyBind("key.left", false)
        }

        function right() {
            KeyBind.keyBind("key.right", true)
            Client.waitTick(1)
            KeyBind.keyBind("key.right", false)
        }

        function boatTo(orderName, coordinates) {
            while (Math.abs(boatPos.x - coordinates.x) >= destTolerance || Math.abs(boatPos.z - coordinates.z) >= destTolerance) {
                KeyBind.keyBind("key.forward", true)
                if (user.getVehicle() == null) {
                    throw ("Boat exited")
                }
                if (KeyBind.getPressedKeys().contains(cancelButton) && !chatOpen) {
                    throw ("Bot cancelled")
                }
                boatPos = {
                    x: user.getVehicle().getX(),
                    z: user.getVehicle().getZ()
                }
                desiredAngle = vecToAngle(boatPos.x, boatPos.z, coordinates.x, coordinates.z)
                boatAngle = user.getVehicle().getYaw()
                if (boatAngle < 0) boatAngle = 360 + boatAngle;
                if (Math.abs(boatAngle - desiredAngle) >= 5) {
                    (boatAngle - desiredAngle + 360) % 360 > 180 ? right() : left() // haha funny numbers go BRRR. main logic for boat rotation.
                } else if (Math.abs(boatAngle - desiredAngle) >= 2) {
                    KeyBind.keyBind("key.right", false)
                    KeyBind.keyBind("key.left", false)
                }


                Client.waitTick(1) // for some strange reason, if this is not here, the game crashes. DONT MODIFY THIS!
            }
            KeyBind.keyBind("key.forward", false)
            //orderName.next();
        }

        let closestNode = undefined
        let closestNodeDistance = 100000000
        //Chat.log(freightData.nodes)

        // Find closest node
        for (index in freightData.nodes) {
            let nodeData = freightData.nodes[index]
            let distanceToNode = PositionCommon.createVec(user.getX(), user.getZ(), nodeData.x, nodeData.z).getMagnitude()

            if (closestNodeDistance > distanceToNode) {
                closestNodeDistance = distanceToNode
                closestNode = nodeData
            }
        }

        if (Math.round(closestNodeDistance) > 5000) {
            throw (`Closest ${closestNode.type} ${closestNode.name} at (${closestNode.x}, ${closestNode.z}) is too far (${Math.round(closestNodeDistance)}m)`)
        }

        Chat.log("§7Closest node is §a" + closestNode.name + "")

        // Prepare the nodes - calculate distance

        for (index in freightData.connections) {
            let connectionData = freightData.connections[index]
            let nodeFrom = freightData.nodes.find(node => node.id == connectionData.from)
            let nodeTo = freightData.nodes.find(node => node.id == connectionData.to)
            let nodeDistance = PositionCommon.createVec(nodeFrom.x, nodeFrom.z, nodeTo.x, nodeTo.z).getMagnitude()

            nodeFrom.connections = nodeFrom.connections || []
            nodeTo.connections = nodeTo.connections || []

            nodeTo.connections.push([nodeFrom.id, nodeDistance])
            nodeFrom.connections.push([nodeTo.id, nodeDistance])

            freightData.connections[index].distance = nodeDistance // cost - we want to minimize dist travelled
        }

        // Armed with distances for each connection, find a route to the goal node

        class PriorityQueue {
            constructor() {
                this.queue = [];
            }
            add(element, priority) {
                this.queue.push([element, priority])
            }
            set_priority(e, deficit) {
                this.queue.find(queued => queued[0] == e)[1] = deficit
            }
            remove_priority(e, deficit) {
                this.queue.find(queued => queued[0] == e)[1] -= deficit
            }

            pull_min() {
                function comparator(a, b) {
                    if (a[1] > b[1]) {
                        return -1
                    } else {
                        return 1
                    }
                }
                this.queue.sort(comparator)

                return this.queue.pop()
            }
        }

        function constructPath(visitedMap, currentNode) {
            let pathArray = [currentNode]
            //Chat.log(visitedMap)

            // Trace back through visits

            while (visitedMap[currentNode] != undefined) {
                //Chat.log('Backtracing '+currentNode)
                currentNode = visitedMap[currentNode][0]
                pathArray.unshift(currentNode)
                Time.sleep(10)
            }
            //Chat.log("pray")
            //Chat.log(pathArray)
            return pathArray
        }


        // Todo: locally cache routes the person uses frequently
        function aStar(start, end) {
            let distanceMap = {} // Updated with distances from the start to the node id that is the index
            let visitedMap = {}
            let nodeValue = {}

            let pq = new PriorityQueue()

            // initialize node distances
            for (let index in freightData.nodes) {
                let nodeData = freightData.nodes[index]

                if (nodeData.id != start) {
                    distanceMap[nodeData.id] = Infinity
                    pq.add(nodeData.id, Infinity)
                } else {
                    distanceMap[nodeData.id] = 0
                    pq.add(nodeData.id, 0)
                }

            }

            let currentNode
            while (pq.queue.length > 0) {
                function comparator(a, b) {
                    if (a[1] > b[1]) {
                        return -1
                    } else {
                        return 1
                    }
                }
                pq.queue.sort(comparator)
                //Chat.log(pq.queue)
                currentNode = pq.queue[pq.queue.length - 1]

                //  Chat.log('Pulling '+currentNode[0])

                if (currentNode[0] == end) {
                    // Chat.log('yay')
                    return constructPath(visitedMap, currentNode[0])
                }
                pq.queue.pop()

                let currentNodeData = freightData.nodes.find(node => node.id == currentNode[0])

                // Check all of the connections from the current node
                for (let connindex in currentNodeData.connections) {
                    //  Chat.log('Reading')
                    let connectionData = currentNodeData.connections[connindex]

                    let distanceToThisNode = distanceMap[currentNode[0]] + connectionData[1]

                    if (distanceToThisNode < distanceMap[connectionData[0]]) {
                        visitedMap[connectionData[0]] = currentNode
                        distanceMap[connectionData[0]] = distanceToThisNode
                        pq.set_priority(connectionData[0], distanceToThisNode)

                        if (!pq.queue.includes(connectionData[0])) {
                            pq.add(connectionData[0], distanceToThisNode)
                        }
                    }
                    // 

                }


                Time.sleep(5)

            }


            //Chat.log(distanceMap)

        }

        // TODO: UI destination selection goes here

        function boatToward(dest) {

            const boatPath = aStar(closestNode.id, dest, true)


            // Convert the nodes to coordinates and boat
            const route = []

            for (node_index in boatPath) {
                let nodeData = freightData.nodes.find(node => node.id == boatPath[node_index])
                route.push(nodeData)
            }
            if (route.length == 1 && route[0].id != closestNode.id) {
                // Highlight nodes that have only one connection. Maybe this should always be done when this is run in 'debug mode'
                // EVEN BETTER - use it as a test to see if a new node json is mergeable to the main branch
                let singleConnected = []

                for (index in freightData.nodes) {
                    let nodeData = freightData.nodes[index]
                    //    Chat.log(nodeData)
                    if (nodeData.connections == undefined || (nodeData.type != "port" && nodeData.connections.length < 2)) {
                        singleConnected.push(nodeData.id)
                    }
                }
                Chat.log(singleConnected.join(", "))
                throw ("Didn't create a proper route to the destination - maybe a connection is missing in the freight_nodes.json? Look into the above nodes if any are listed.")
            }
            for (step_index in route) {

                const step = route[step_index]
                Chat.log(`§7Boating to ${step.type} ${step.name || "located"} at (${step.x},${step.z})`)
                boatTo(null, step)
                Client.waitTick()
            }

            Chat.log(`§aBoating complete! Arrived at ${route[route.length-1].name}`)
            World.playSound("block.note_block.bit", 10, 1.3)
        }


        // UI to get a destination node
        const selectDestinationUI = Hud.createScreen('Raidfreighter ' + version, false);
        let ports = []
        let portMap = {}
        let mapPort = {}

        let specialNodes = ["icarus-portal"]
        for (port of freightData.nodes) {
            if (port.type == "port" || specialNodes.includes(port.id)) {
                ports.push(port.name)
                portMap[port.name] = port.id
                mapPort[port.id] = port.name
            }
        }

        // add a checkbox for listing nodes as well as ports
        let selectedPort = "blue-cove"
        const clientOptions = Client.getGameOptions()

        function getEmptyJavaFunction() { // have to do this because jsmacros expects a java function to be passed when making a text input even though we're not using it
            return JavaWrapper.methodToJava(() => {})
        }

        function portAutocomplete(input) {
            return ports.filter(item => item.toLowerCase().startsWith(input.toLowerCase()))[0]
        }

        function initSelect() {
            //TODO: improve gui math so it doesn't only render as intended at 3x. Maybe make a library?
            let w = selectDestinationUI.getWidth()
            let h = selectDestinationUI.getHeight()
            let quarterh = Math.round(h / 4)
            let eighthH = Math.round(h / 8)
            let textX = Math.round(w / 10)
            let textX2 = Math.round(w / 2)

            if (clientOptions.getGuiScale() != 3) {
                clientOptions.setGuiScale(3)
                Chat.toast("Raederfreighter", "Your GUI scale was automatically set to 3 to improve UI rendering.")
            }
            /*selectDestinationUI.addCyclingButton(textX2, quarterh + 80, 200, 20, ports, "BlueCove", JavaWrapper.methodToJava(() => {
               
               // Chat.log('hi!')
                //Chat.log(portSelection)
               // Chat.log("Actually wants to go to port " + portMap[portSelection]);

               // selectedPort = portSelection
            }));*/

            selectDestinationUI.addText("Type destination (autocompletes)", textX2 - 80, Math.round(quarterh) - 25, 16777215, false)
            //Chat.log(closestNode)
            //Chat.log(mapPort)
            let portInput = selectDestinationUI.addTextInput(textX2 - 75, Math.round(quarterh) - 5, 150, 19, closestNode.name, getEmptyJavaFunction())

            selectDestinationUI.addButton(textX2 - 50, quarterh + 30, 100, 20, "Go", JavaWrapper.methodToJava(() => {

                selectedPort = portAutocomplete(portInput.getText())

                selectDestinationUI.close()
                JavaWrapper.methodToJavaAsync(() => {
                    Chat.log(`§7Goal: §l§b${selectedPort}`)
                    boatToward(portMap[selectedPort])
                    KeyBind.keyBind("key.forward", false)
                }).run()

            }))
            selectDestinationUI.addButton(textX2 - 50, quarterh + 50, 100, 20, "Close", JavaWrapper.methodToJava(() => {
                selectDestinationUI.close()
                const ctx = context.getCtx();
                // TODO: Make this not spam your chat /w errors
                ctx.closeContext()

            }))

            // Add port options info

            let portOptionsX = 10
            selectDestinationUI.addText("Ports:", portOptionsX, 0 + 55, 16777215, false)

            for (portIndex in ports) {
                let port = ports[portIndex]

                selectDestinationUI.addText(port, portOptionsX, 0 + (65 + (10 * portIndex + 1)), 16777215, false)

            }

        }

        selectDestinationUI.setOnInit(JavaWrapper.methodToJava(initSelect))

        Hud.openScreen(selectDestinationUI)

    }
}

main()
