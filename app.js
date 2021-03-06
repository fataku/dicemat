var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 80;
var mongo = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectID;

var db = null;

/*mongo.connect('mongodb://localhost:27017/dicemat', function(err, database){
	if(!err) db = database;
	else console.log('[ERROR]:', err);
});//*/

app.get('/', function(req, res){
	res.sendfile(__dirname + '/assets/index.html');
});

app.get('/generate/:id', function(req,res){
	var id = new ObjectId(req.params.id);
	
	if(db) db.collection('rolls').findOne({_id:id}, function(err, roll){
		//build SVG string
		var dataWidth = 15;
		var fontHeight = 10;
		var lineHeight = 14;
		var svgBody = [];
		var total = 0;
		var paddingLines = 2;
		var successes = 0;
		
		if(roll.rules.sort || roll.rules.xhighest) roll.results.sort(function(a, b){return b-a;});
		
		roll.results.forEach(function(v, i, a){
			var c = "", r = v;
			if(r === 1)											{c = "red";}
			if(r === 20)										{c = "green";}
			if(roll.rules.threshold && r>= roll.rules.threshold){c = "#5a1"; successes++;}
			if(roll.rules.doubles && r >= roll.rules.doubles)	{c = "green"; successes++;}
			if(roll.rules.rerolls>1 && r>= roll.rules.rerolls) 	{c = "blue";}
			if(i < roll.rules.xhighest)							{c = "blue";}

			if(roll.rules.total && (!roll.rules.xhighest || i < roll.rules.xhighest)){
				total += r
			}

			a[i] = ('   ' + v).slice(-3);
			a[i] = '<tspan fill="'+c+'">'+a[i]+'</tspan>';//*/
			
		});
		
		
		//roll.results.sort().reverse();
		for(var i = 0, ii = roll.results.length/dataWidth; i<ii; i++){
			svgBody.push(
			'    <text x="10" y="'+(lineHeight*1.5+i*lineHeight)+'" style="font-family: monospace; font-size: '+fontHeight+'pt; white-space:pre;" text-anchor="left" fill="black">'+roll.results.slice(dataWidth*i, dataWidth+i*dataWidth).join(' ')+'</text>\n'
			);
		}
		if(roll.rules.total || roll.rules.threshold){
			paddingLines++; i+= 0.5;
			var line = '    <text x="10" y="'+(lineHeight*1.5+i*lineHeight)+'" style="font-family: monospace; font-size: '+fontHeight+'pt; white-space:pre;" text-anchor="left" fill="black">';
			if(roll.rules.total) line += 'Total: '+total;
			if(roll.rules.total && roll.rules.threshold) line += '; ';
			if(roll.rules.threshold) line += 'Successes: '+successes;
			line += '</text>\n';
			svgBody.push(line);
			
		}
		
		var height = Math.ceil(roll.results.length/dataWidth+paddingLines) * lineHeight;
		var svgHead = ''+
			'<svg version="1.1" width="490" height="'+height+'" xmlns="http://www.w3.org/2000/svg" style="overflow: hidden; position: relative;" base-profile="full">\n'+
			'    <rect x="0" y="0" width="490" height="'+height+'" r="10" rx="10" ry="10" fill="rgba(200, 200, 200, 0.2)" stroke="none" style="-webkit-tap-highlight-color: rgba(0, 0, 0, 0);"></rect>\n';

		var svgFoot = ''+
			'    <desc style="-webkit-tap-highlight-color: rgba(0, 0, 0, 0);">Image Automatically Generated by Dicemat.js</desc>\n'+
			'    <defs style="-webkit-tap-highlight-color: rgba(0, 0, 0, 0);"></defs>\n'+
			'</svg>'
			
		
		res.set('content-Type', 'image/svg+xml').send(svgHead + svgBody.join('') + svgFoot.toString('base64'))
	}); else {
		console.log('[ERROR]: Nod DB connection >:|');
		res.status(400).send("No database connection. This is pretty bad.");
	}
});

app.use(express.static(__dirname + '/assets'));

var names = {}, // socket.id : name
	clients = {}; // name : socket.id

io.on('connection', function(socket){
	socket.emit('self', socket.id);

	socket.on('roll', function(data){
		data.id = socket.id;
		data.name = names[socket.id];
		
		if(db){
			db.collection('rolls').insertOne(data, function(err, result){
				if(err) console.log('[ERROR]:', err);
				broadcastRoll(socket, data);
			});
		} else {
			broadcastRoll(socket, data);
		}
	});

	socket.on('chat', function(data){
		for(var i in socket.rooms){
			io.to(socket.rooms[i]).emit('chat', socket.id, data);
		}
	});

	socket.on('identify', function(name){
		console.log("["+(new Date()).toLocaleString() + "]", 'identifying', socket.id, 'as', name);
		if(clients[name] || name === 'Anonymous')
			socket.emit('err', 'That name is already taken.');
		else{
			// name change, clear the old using uid, then set the new
			clients[names[socket.id]] = undefined;
			clients[name] = socket.id;
			names[socket.id] = name;

			// notify party members of change
			for(var i in socket.rooms){
				socket.broadcast.to(socket.rooms[i]).emit('rename', {
					id:socket.id,
					name:name
				});
			}
		}
	});

	socket.on('join', function(room){
		console.log("["+(new Date()).toLocaleString() + "]", 'Adding', socket.id, 'to room', room);

		// leave prior rooms
		for(var i in socket.rooms){
			var r = socket.rooms[i];
			if(r != socket.id){
				socket.broadcast.to(r).emit('leave', socket.id);
				socket.leave(r);
			}
		}

		// TODO:get Member List
		var roomInfo = io.sockets.adapter.rooms[room] || {};
		var memberList = Object.keys(roomInfo);
		var memberInfo = {};
		for(var i in memberList){
			var id = memberList[i];
			memberInfo[id] = names[id] || "Anonymous";
		}

		//console.log(memberInfo);
		socket.join(room);
		// tell members that a new member has joined
		socket.broadcast.to(room).emit('join', {
			id:socket.id, name:names[socket.id]
		});
		socket.emit('memberlist', memberInfo);
	});

	socket.on('leave', function(id){
		socket.leave(id);
		socket.to(id).emit('leave', socket.id);
	});

	socket.on('disconnect', function(s){
		clients[names[socket.id]] = names[socket.id] = undefined;
		delete clients[names[socket.id]];
		delete names[socket.id];
		io.to(socket.id).emit('quit', socket.id)
		for(var room in socket.rooms){
			io.to(socket.rooms[room]).emit('leave', socket.id);
		}
		console.log("["+(new Date()).toLocaleString() + "]", 'disconnect ('+socket.id+'), leaving from', socket.rooms);
	});
});

http.listen(port, function(){
	console.log('Listening on port', port);
});

function broadcastRoll(socket, data){
	for(var i in socket.rooms){
		socket.broadcast.to(socket.rooms[i]).emit('roll', data);
	}
}