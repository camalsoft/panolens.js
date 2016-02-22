( function () {

	'use strict';

	/**
	 * Viewer contains pre-defined scene, camera and renderer
	 * @constructor
	 * @param {object} [options] - Use custom or default config options
	 * @param {HTMLElement} [options.container] - A HTMLElement to host the canvas
	 * @param {THREE.Scene} [options.scene=THREE.Scene] - A THREE.Scene which contains panorama and 3D objects
	 * @param {THREE.Camera} [options.camera=THREE.PerspectiveCamera] - A THREE.Camera to view the scene
	 * @param {THREE.WebGLRenderer} [options.renderer=THREE.WebGLRenderer] - A THREE.WebGLRenderer to render canvas
	 * @param {boolean} [options.controlBar=true] - Show/hide control bar on the bottom of the container
	 * @param {boolean} [options.autoHideControlBar=false] - Auto hide control bar when click on non-active area
	 * @param {boolean} [options.autoHideInfospot=false] - Auto hide infospots when click on non-active area
	 * @param {boolean} [options.horizontalView=false] - Allow only horizontal camera control
	 * @param {object}  [options.WebVRConfig] - WebVR configuration
	 */
	PANOLENS.Viewer = function ( options ) {

		THREE.EventDispatcher.call( this );
		
		if ( !THREE ) {

			console.error('Three.JS not found');

			return;
		}

		options = options || {};
		options.controlBar = options.controlBar !== undefined ? options.controlBar : true;
		options.autoHideControlBar = options.autoHideControlBar !== undefined ? options.autoHideControlBar : false;
		options.autoHideInfospot = options.autoHideInfospot !== undefined ? options.autoHideInfospot : true;
		options.horizontalView = options.horizontalView !== undefined ? options.horizontalView : false;
		options.WebVRConfig = options.WebVRConfig || { FORCE_ENABLE_VR: true, FORCE_DISTORTION: true };
		options.clickTolerance = options.clickTolerance || 10;

		// WebVR Configuration
		if ( options.WebVRConfig ) {
			
			for ( var config in options.WebVRConfig ) {

				if ( options.WebVRConfig.hasOwnProperty( config ) ) {

					window.WebVRConfig[ config ] = options.WebVRConfig[ config ];

				}

			}

		}
		
		this.options = options;

		this.camera = options.camera || new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 10000 );
		this.scene = options.scene || new THREE.Scene();
		this.renderer = options.renderer || new THREE.WebGLRenderer( { alpha: true, antialias: true } );
		this.VREffect;
		this.VRManager;
		this.container;

		this.OrbitControls;
		this.DeviceOrientationControls;
		this.VRControls;

		this.controls;
		this.panorama;
		this.widget;
		
		this.hoverObject;
		this.hoveringObject;
		this.pressEntityObject;
		this.pressObject;

		this.raycaster = new THREE.Raycaster();
		this.userMouse = new THREE.Vector2();
		this.updateCallbacks = [];
		this.DEBUG = false;

		// Renderer
		this.renderer.setPixelRatio( window.devicePixelRatio );
		this.renderer.setSize( window.innerWidth, window.innerHeight );

		// Container
		if ( options.container ) {

			this.container = options.container;

		} else {

			this.container = document.createElement('div');
			document.body.appendChild( this.container );

		}

		// Append Renderer Element to container
		this.renderer.domElement.classList.add( 'panolens-canvas' );
		this.container.appendChild( this.renderer.domElement );

		// Camera Controls
		this.OrbitControls = new THREE.OrbitControls( this.camera, this.container );
		this.OrbitControls.name = 'orbit';
		this.OrbitControls.minDistance = 1;
		this.OrbitControls.noPan = true;
		this.DeviceOrientationControls = new THREE.DeviceOrientationControls( this.camera );
		this.DeviceOrientationControls.name = 'device-orientation';
		this.VRControls = new THREE.VRControls( this.camera );

        // Apply VR stereo rendering to renderer.
        this.VREffect = new THREE.VREffect( this.renderer );
        this.VREffect.setSize( window.innerWidth, window.innerHeight );

        this.VRManager = new WebVRManager( this.renderer, this.VREffect, { 
            hideButton: true, isUndistorted: false } );

		this.controls = [ this.OrbitControls, this.DeviceOrientationControls ];
		this.control = this.OrbitControls;
		
		// Lock horizontal view
		if ( this.options.horizontalView ) {
			this.OrbitControls.minPolarAngle = Math.PI / 2;
			this.OrbitControls.maxPolarAngle = Math.PI / 2;
		}

		// Add Control UI
		if ( this.options.controlBar !== false ) {
			this.addDefaultControlBar();
		}
		
		// Mouse / Touch Event
		this.container.addEventListener( 'mousedown', this.onMouseDown.bind( this ), true );
		this.container.addEventListener( 'mousemove', this.onMouseMove.bind( this ), true );
		this.container.addEventListener( 'mouseup', this.onMouseUp.bind( this ), true );
		this.container.addEventListener( 'touchstart', this.onMouseDown.bind( this ), true );
		this.container.addEventListener( 'touchend', this.onMouseUp.bind( this ), true );

		// Resize Event
		window.addEventListener( 'resize', this.onWindowResize.bind( this ), true );

		// Keyboard Event
		window.addEventListener( 'keydown', this.onKeyDown.bind( this ), true );
		window.addEventListener( 'keyup', this.onKeyUp.bind( this ), true );

		// Animate
		this.animate.call( this );

	}

	PANOLENS.Viewer.prototype = Object.create( THREE.EventDispatcher.prototype );

	PANOLENS.Viewer.prototype.constructor = PANOLENS.Viewer;

	PANOLENS.Viewer.prototype.add = function ( object ) {

		if ( arguments.length > 1 ) {

			for ( var i = 0; i < arguments.length; i ++ ) {

				this.add( arguments[ i ] );

			}

			return this;

		}

		this.scene.add( object );

		// All object added to scene has 'panolens-viewer-handler' event to handle viewer communication
		if ( object.addEventListener ) {

			object.addEventListener( 'panolens-viewer-handler', this.eventHandler.bind( this ) );

		}

		if ( object.type === 'panorama' ) {

			this.addPanoramaEventListener( object );

			if ( !this.panorama ) {

				this.setPanorama( object );

			}

		}

	};

	PANOLENS.Viewer.prototype.addDefaultControlBar = function () {

		if ( this.widget ) {

			console.warn( 'Default control bar exists' );
			return;

		}

		this.widget = new PANOLENS.Widget( this.container );
		this.widget.addEventListener( 'panolens-viewer-handler', this.eventHandler.bind( this ) );
		this.widget.addDefaultControlBar();

	};

	PANOLENS.Viewer.prototype.setPanorama = function ( pano ) {

		if ( pano.type === 'panorama' ) {
			
			// Reset Current Panorama
			this.panorama && this.panorama.onLeave();

			// Assign and enter panorama
			(this.panorama = pano).onEnter();
			
		}

	};

	PANOLENS.Viewer.prototype.eventHandler = function ( event ) {

		if ( event.method && this[ event.method ] ) {

			this[ event.method ]( event.data );

		}

	};

	PANOLENS.Viewer.prototype.toggleVR = function () {

		if ( this.VRManager ) {
			if ( this.VRManager.mode !== WebVRManager.Modes.VR ) {
				this.VRManager.onVRClick_();
			} else {
				this.VRManager.onBackClick_();
			}
		}

	};

	PANOLENS.Viewer.prototype.toggleVideoPlay = function () {

		if ( this.panorama instanceof PANOLENS.VideoPanorama ) {

			this.panorama.dispatchEvent( { type: 'video-toggle' } );

		}

	};

	PANOLENS.Viewer.prototype.setVideoCurrentTime = function ( percentage ) {

		if ( this.panorama instanceof PANOLENS.VideoPanorama ) {

			this.panorama.dispatchEvent( { type: 'video-time', percentage: percentage } );

		}

	};

	PANOLENS.Viewer.prototype.onVideoUpdate = function ( percentage ) {

		this.widget && this.widget.dispatchEvent( { type: 'video-update', percentage: percentage } );

	};

	PANOLENS.Viewer.prototype.addUpdateCallback = function ( fn ) {

		if ( fn ) {

			this.updateCallbacks.push( fn );

		}

	};

	PANOLENS.Viewer.prototype.removeUpdateCallback = function ( fn ) {

		var index = this.updateCallbacks.indexOf( fn );

		if ( fn && index >= 0 ) {

			this.updateCallbacks.splice( index, 1 );

		}

	};

	PANOLENS.Viewer.prototype.showVideoWidget = function () {

		this.widget && this.widget.dispatchEvent( { type: 'video-control-show' } );

	};

	PANOLENS.Viewer.prototype.hideVideoWidget = function () {

		this.widget && this.widget.dispatchEvent( { type: 'video-control-hide' } );

	};

	PANOLENS.Viewer.prototype.addPanoramaEventListener = function ( pano ) {

		// Every panorama
		pano.addEventListener( 'enter-start', this.setCameraControl.bind( this ) );

		// VideoPanorama
		if ( pano instanceof PANOLENS.VideoPanorama ) {

			pano.addEventListener( 'enter', this.showVideoWidget.bind( this ) );
			pano.addEventListener( 'leave', this.hideVideoWidget.bind( this ) );

		}


	};

	PANOLENS.Viewer.prototype.setCameraControl = function () {

		this.camera.position.copy( this.panorama.position );
		this.camera.position.z += 1;
		this.OrbitControls.target.copy( this.panorama.position );

	};

	PANOLENS.Viewer.prototype.getControl = function () {

		return this.control;

	},

	PANOLENS.Viewer.prototype.getScene = function () {

		return this.scene;

	};

	PANOLENS.Viewer.prototype.getCamera = function () {

		return this.camera;

	},

	PANOLENS.Viewer.prototype.getRenderer = function () {

		return this.renderer;

	};

	PANOLENS.Viewer.prototype.getContainer = function () {

		return this.container;

	};

	PANOLENS.Viewer.prototype.getControlName = function () {

		return this.control.name;

	};

	PANOLENS.Viewer.prototype.getNextControlName = function () {

		return this.controls[ this.getNextControlIndex() ].name;

	};

	PANOLENS.Viewer.prototype.getNextControlIndex = function () {

		return ( this.controls.indexOf( this.control ) + 1 >= this.controls.length ) ? 0 : this.controls.indexOf( this.control ) + 1;

	};

	PANOLENS.Viewer.prototype.enableControl = function ( index ) {

		index = ( index >= 0 && index < this.controls.length ) ? index : 0;

		this.control.enabled = false;

		this.control = this.controls[ index ];

		this.control.enabled = true;

		switch ( this.control.name ) {
			case 'orbit':
				this.camera.position.copy( this.panorama.position );
				this.camera.position.z += 1;
				break;
			case 'device-orientation':
				this.camera.position.copy( this.panorama.position );
				break;
			default:
				break;
		}

	};

	PANOLENS.Viewer.prototype.toggleNextControl = function () {

		this.enableControl( this.getNextControlIndex() );

	};

	PANOLENS.Viewer.prototype.onWindowResize = function () {

		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();

		this.renderer.setSize( window.innerWidth, window.innerHeight );

		this.dispatchEvent( { type: 'window-resize', width: window.innerWidth, height: window.innerHeight })
	};

	PANOLENS.Viewer.prototype.render = function () {

		TWEEN.update();
		this.updateCallbacks.forEach( function( callback ){ callback(); } );
		this.control && this.control.update();
		this.VRManager && this.VRControls && this.VRManager.Mode === WebVRManager.Modes.VR && this.VRControls.update(); 
		this.VRManager.render( this.scene, this.camera );

	};

	PANOLENS.Viewer.prototype.onMouseDown = function ( event ) {

		event.preventDefault();

		this.userMouse.x = ( event.clientX ) ? event.clientX : event.touches[0].clientX;
		this.userMouse.y = ( event.clientY ) ? event.clientY : event.touches[0].clientY;
		this.userMouse.type = 'mousedown';
		this.onTap( event );

	};

	PANOLENS.Viewer.prototype.onMouseMove = function ( event ) {

		event.preventDefault();
		this.userMouse.type = 'mousemove';
		this.onTap( event );

	};

	PANOLENS.Viewer.prototype.onMouseUp = function ( event ) {

		var onTarget = false, type;

		this.userMouse.type = 'mouseup';

		type = ( this.userMouse.x >= event.clientX - this.options.clickTolerance 
				&& this.userMouse.x <= event.clientX + this.options.clickTolerance
				&& this.userMouse.y >= event.clientY - this.options.clickTolerance
				&& this.userMouse.y <= event.clientY + this.options.clickTolerance ) 
				||  ( event.changedTouches 
				&& this.userMouse.x >= event.changedTouches[0].clientX - this.options.clickTolerance
				&& this.userMouse.x <= event.changedTouches[0].clientX + this.options.clickTolerance 
				&& this.userMouse.y >= event.changedTouches[0].clientY - this.options.clickTolerance
				&& this.userMouse.y <= event.changedTouches[0].clientY + this.options.clickTolerance ) 
		? 'click' : undefined;

		// Event should happen on canvas
		if ( event && event.target && !event.target.classList.contains( 'panolens-canvas' ) ) { return; }

		event.preventDefault();

		if ( event.changedTouches && event.changedTouches.length === 1 ) {

			onTarget = this.onTap( { clientX : event.changedTouches[0].clientX, clientY : event.changedTouches[0].clientY }, type );
		
		} else {

			onTarget = this.onTap( event, type );

		}

		this.userMouse.type = 'none';

		if ( onTarget ) { 

			return; 

		}

		if ( type === 'click' ) {

			this.options.autoHideInfospot && this.panorama && this.panorama.toggleChildrenVisibility();
			this.options.autoHideControlBar && toggleControlBar();

		}

	};

	PANOLENS.Viewer.prototype.onTap = function ( event, type ) {

		var point = {}, object, intersects, intersect_entity, intersect;

		point.x = ( event.clientX / window.innerWidth ) * 2 - 1;
		point.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

		this.raycaster.setFromCamera( point, this.camera );

		if ( !this.panorama ) { return; }

		// For Adding Infospot
		if ( this.DEBUG ) {

			intersects = this.raycaster.intersectObject( this.panorama, true );

			if ( intersects.length > 0 ) {

				intersects[0].point.applyAxisAngle( new THREE.Vector3( -1, 0, 0 ), this.panorama.rotation.x );
				intersects[0].point.applyAxisAngle( new THREE.Vector3( 0, -1, 0 ), this.panorama.rotation.y );
				intersects[0].point.applyAxisAngle( new THREE.Vector3( 0, 0, -1 ), this.panorama.rotation.z );

				intersects[0].point.sub( this.panorama.position );

				console.info('{ ' + (-intersects[0].point.x).toFixed(2) + 
					', ' + (intersects[0].point.y).toFixed(2) +
					', ' + (intersects[0].point.z).toFixed(2) + ' }'
				);

			}
			
		}

		intersects = this.raycaster.intersectObjects( this.panorama.children, true );

		intersect_entity = this.getConvertedIntersect( intersects );

		intersect = ( intersects.length > 0 ) ? intersects[0].object : intersect;

		if ( this.userMouse.type === 'mouseup'  ) {

			if ( intersect_entity && this.pressEntityObject === intersect_entity && this.pressEntityObject.dispatchEvent ) {

				this.pressEntityObject.dispatchEvent( { type: 'pressstop-entity', mouseEvent: event } );

			}

			this.pressEntityObject = undefined;

		}

		if ( this.userMouse.type === 'mouseup'  ) {

			if ( intersect && this.pressObject === intersect && this.pressObject.dispatchEvent ) {

				this.pressObject.dispatchEvent( { type: 'pressstop', mouseEvent: event } );

			}

			this.pressObject = undefined;

		}

		if ( type === 'click' ) {

			this.panorama.dispatchEvent( { type: 'click', intersects: intersects, mouseEvent: event } );

			if ( intersect_entity && intersect_entity.dispatchEvent ) {

				intersect_entity.dispatchEvent( { type: 'click-entity', mouseEvent: event } );

			}

			if ( intersect && intersect.dispatchEvent ) {

				intersect.dispatchEvent( { type: 'click', mouseEvent: event } );

			}

		} else {

			this.panorama.dispatchEvent( { type: 'hover', intersects: intersects, mouseEvent: event } );

			if ( ( this.hoverObject && intersects.length > 0 && this.hoverObject !== intersect_entity )
				|| ( this.hoverObject && intersects.length === 0 ) ){

				if ( this.hoverObject.dispatchEvent ) {

					this.hoverObject.dispatchEvent( { type: 'hoverleave', mouseEvent: event } );

				}

				this.hoverObject = undefined;

			}

			if ( intersect_entity && intersects.length > 0 ) {

				if ( this.hoverObject !== intersect_entity ) {

					this.hoverObject = intersect_entity;

					if ( this.hoverObject.dispatchEvent ) {

						this.hoverObject.dispatchEvent( { type: 'hoverenter', mouseEvent: event } );

					}

				}

				if ( this.userMouse.type === 'mousedown' && this.pressEntityObject != intersect_entity ) {

					this.pressEntityObject = intersect_entity;

					if ( this.pressEntityObject.dispatchEvent ) {

						this.pressEntityObject.dispatchEvent( { type: 'pressstart-entity', mouseEvent: event } );

					}

				}

				if ( this.userMouse.type === 'mousedown' && this.pressObject != intersect ) {

					this.pressObject = intersect;

					if ( this.pressObject.dispatchEvent ) {

						this.pressObject.dispatchEvent( { type: 'pressstart', mouseEvent: event } );

					}

				}

				if ( this.userMouse.type === 'mousemove' ) {

					if ( this.pressEntityObject && this.pressEntityObject.dispatchEvent ) {

						this.pressEntityObject.dispatchEvent( { type: 'pressmove-entity', mouseEvent: event } );

					}

				}

				if ( this.userMouse.type === 'mousemove' ) {

					if ( this.pressObject && this.pressObject.dispatchEvent ) {

						this.pressObject.dispatchEvent( { type: 'pressmove', mouseEvent: event } );

					}

				}

			}

		}

		if ( intersects.length > 0 && intersects[ 0 ].object instanceof PANOLENS.Infospot ) {

			object = intersects[ 0 ].object;

			if ( object.onHover ) {

				this.hoveringObject = object;

				this.container.style.cursor = 'pointer';

				object.onHover( event.clientX, event.clientY );

			}

			if ( type === 'click' && object.onClick ) {

				object.onClick();

				return true;

			}

		} else {

			this.container.style.cursor = 'default';

			this.hideHoveringObject();

		}

	};

	PANOLENS.Viewer.prototype.getConvertedIntersect = function ( intersects ) {

		var intersect;

		for ( var i = 0; i < intersects.length; i++ ) {

			if ( intersects[i].object && !intersects[i].object.passThrough ) {

				if ( intersects[i].object.entity && intersects[i].object.entity.passThrough ) {
					continue;
				} else if ( intersects[i].object.entity && !intersects[i].object.entity.passThrough ) {
					intersect = intersects[i].object.entity;
					break;
				} else {
					intersect = intersects[i].object;
					break;
				}

			}

		}

		return intersect;

	};

	PANOLENS.Viewer.prototype.hideHoveringObject = function ( intersects ) {

		if ( this.hoveringObject ) {

			this.hoveringObject.onHoverEnd();

			this.hoveringObject = undefined;

		}

	};

	PANOLENS.Viewer.prototype.toggleControlBar = function () {

		widget && widget.dispatchEvent( { type: 'control-bar-toggle' } );

	};

	PANOLENS.Viewer.prototype.onKeyDown = function ( event ) {

		if ( event.keyCode === 17 || event.keyIdentifier === 'Control' ) {

			this.DEBUG = true;

		}

	};

	PANOLENS.Viewer.prototype.onKeyUp = function ( event ) {

		this.DEBUG = false;

	};

	PANOLENS.Viewer.prototype.animate = function () {

		window.requestAnimationFrame( this.animate.bind( this ) );

        this.render();

	};

} )();