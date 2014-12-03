var scope = self;
(function() { // namespace

var exports = (typeof module !== 'undefined' && module.exports) ?
    module.exports : scope.priority_queue = {};

exports.PriorityQueue = function PriorityQueue(compare, queue, fixedLength) {
  if (!(this instanceof PriorityQueue)) return new PriorityQueue(compare, queue, fixedLength);

  compare     = compare || min_first;
  queue       = queue   || [];
	fixedLength = fixedLength || Infinity;
	if(queue.length > fixedLength) {
		throw new Error("Initializing fixed-length queue with a sequence that is too long.");
	}

  function swap(i, j) { var t = queue[i]; queue[i] = queue[j]; queue[j] = t; }

  function heapify(i) {
    var length = queue.length, x, l, r;
    while (true) {
      x = i; l = left(i); r = right(i);
      if (l < length && compare(queue[l], queue[x]) < 0) x = l;
      if (r < length && compare(queue[r], queue[x]) < 0) x = r;
      if (x === i) break;
      swap(i, x);
      i = x;
    }
  }

  function remove(i) {
    var t = queue[i], b = queue.pop();
    if (queue.length > 0) {
      queue[i] = b;
      heapify(i);
    }
    return t;
  }
  
	this.peek = function peek() {
		return queue[0];
	}
	
	//NB: assumes i is in the fringe.
	function replaceAndBubble(elt, i) {
		queue[i] = elt;
		p = parent(i);
  	while(i > 0 && compare(queue[i], queue[p]) < 0) {
  	  swap(i, p);
			i = p;
			p = parent(i);
  	}
	}

	if(fixedLength == Infinity) {
		this.push = function(element) {
			replaceAndBubble(element, queue.length);
			return null;
		}
	} else {
		var fringeIndex = fixedLength != Infinity ? ((1+fixedLength/2) | 0) : -1;
  	this.push = function(element) {
			if(queue.length < fixedLength) {
				replaceAndBubble(element, queue.length);
				return null;
			} else {
				var overflow = queue[fringeIndex];
				if(compare(overflow, queue[element]) < 0) {
					//replace queue[fringeIndex] with element
					queue[fringeIndex] = element;
					replaceAndBubble(element, fringeIndex);
				} else {
					//let the new element overflow
					overflow = element;
				}
				fringeIndex = fringeIndex + 1;
				if(fringeIndex >= fixedLength) {
					fringeIndex = (1+queue.length/2) | 0;
				}
				return overflow;
			}
  	}
	}
  	
  this.shift = function shift() { return remove(0); }
  this.__defineGetter__('length', function length() { return queue.length });
  this._queue = queue;

  for (var i = parent(queue.length - 1); i >= 0; --i) { heapify(i) }
}

function left(i)   { return 2 * i + 1 }
function right(i)  { return 2 * i + 2 }
function parent(i) { return Math.floor((i + 1) / 2) - 1 }

var max_first = exports.max_first = function max_first(a, b) { return b - a }
  , min_first = exports.min_first = function min_first(a, b) { return a - b }
  ;

})(); // end of namespace
