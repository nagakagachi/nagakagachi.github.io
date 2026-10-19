@group(0) @binding(1) var<storage,read_write> terrain: array<u32>;
@group(0) @binding(2) var<storage,read> plants: array<Plant>;
@group(0) @binding(3) var<storage,read_write> nextPlants: array<Plant>;
@group(0) @binding(4) var<storage,read_write> sunlight: array<u32>;
@group(0) @binding(5) var<storage,read_write> energies: array<f32>;
// Seeded value noise and analytic tunnel fields; no per-map coordinate presets.
fn lattice(p: vec3i, salt: u32) -> f32 {
  let key=(bitcast<u32>(p.x)*73856093u) ^ (bitcast<u32>(p.y)*19349663u) ^ (bitcast<u32>(p.z)*83492791u);
  return random(key ^ settings.display.y ^ salt);
}
fn noise(p: vec3f, salt: u32) -> f32 {
  let cell=vec3i(floor(p));let t=fract(p);let u=t*t*(vec3f(3)-2.0*t);
  let a=mix(lattice(cell,salt),lattice(cell+vec3i(1,0,0),salt),u.x);
  let b=mix(lattice(cell+vec3i(0,1,0),salt),lattice(cell+vec3i(1,1,0),salt),u.x);
  let c=mix(lattice(cell+vec3i(0,0,1),salt),lattice(cell+vec3i(1,0,1),salt),u.x);
  let d=mix(lattice(cell+vec3i(0,1,1),salt),lattice(cell+vec3i(1,1,1),salt),u.x);
  return mix(mix(a,b,u.y),mix(c,d,u.y),u.z);
}
fn parameter(lane: u32) -> f32 { return random(settings.display.y ^ (lane*2654435761u)); }
fn terrainAt(p: vec3u) -> bool {
  if(p.y<=1u) { return true; }
  let size=vec3f(settings.world.xyz);
  let point=vec3f(p)+vec3f(0.5);
  let q=point/size;
  let warp=vec2f(noise(vec3f(q.x*3.0,0,q.z*3.0),17u),noise(vec3f(q.x*3.0,0,q.z*3.0),29u))-vec2f(0.5);
  let landscape=noise(vec3f(q.x*3.5+warp.x,0,q.z*3.5+warp.y),41u);
  let ridge=1.0-abs(2.0*noise(vec3f(q.x*2.1,0,q.z*2.1),73u)-1.0);
  let height=size.y*(0.10+0.22*landscape+0.23*ridge);
  // A true 3D field, not a height-only surface: vertical bands bulge and recede.
  let detail=(noise(point/vec3f(18,9,18),101u)-0.5)*size.y*0.22;
  let ledges=sin(point.y*0.32+landscape*5.0)*(1.0-q.y)*3.0;
  if(point.y>height+detail+ledges) { return false; }
  for(var tunnel=0u;tunnel<4u;tunnel++) {
    let lane=100u+tunnel*11u;
    let alongX=parameter(lane)>0.5;
    let along=select(point.z,point.x,alongX);
    let across=select(point.x,point.z,alongX);
    let acrossSize=select(size.x,size.z,alongX);
    let phase=parameter(lane+1u)*6.2831853;
    let centerAcross=acrossSize*(0.18+parameter(lane+2u)*0.64)+sin(along/(18.0+parameter(lane+3u)*20.0)+phase)*acrossSize*0.10;
    let centerY=size.y*(0.14+parameter(lane+4u)*0.18)+sin(along/31.0+phase)*size.y*0.035;
    let radius=size.y*(0.065+parameter(lane+5u)*0.045);
    let delta=vec2f((across-centerAcross)/radius,(point.y-centerY)/(radius*0.8));
    if(dot(delta,delta)<1.0) { return false; }
  }
  return true;
}
@compute @workgroup_size(64)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;if(i>=settings.world.w) { return; }
  terrain[i]=select(0u,1u,terrainAt(coordinate(i)));
  nextPlants[i]=emptyPlant();sunlight[i]=0u;energies[i]=0.0;
}
// Separate dispatch: all terrain writes complete before roots inspect support cells.
@compute @workgroup_size(64)
fn seedPlants(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x;if(i>=settings.world.w) { return; }
  let p=coordinate(i);
  if(terrain[i]==0u && p.y>0u && terrain[address(p-vec3u(0,1,0))]!=0u && random(i ^ settings.display.y)<0.004) {
    nextPlants[i]=Plant(5.0,0.0,0u,1u,0u,i+1u);
  }
}
// One invocation owns an entire vertical column; no cross-workgroup synchronization.
@compute @workgroup_size(64)
fn illuminate(@builtin(global_invocation_id) id: vec3u) {
  let column=id.x; if(column>=settings.world.x*settings.world.z) { return; }
  let x=column%settings.world.x; let z=column/settings.world.x;
  var open=true;
  for(var y=i32(settings.world.y)-1; y>=0; y--) {
    let i=address(vec3u(x,u32(y),z));
    sunlight[i]=select(0u,1u,open);
    if(terrain[i]!=0u || plants[i].energy>0.0) { open=false; }
  }
}
fn attached(i: u32) -> bool {
  let plant=plants[i]; let p=coordinate(i);
  if(plant.parent==0u) { return p.y>0u && terrain[address(p-vec3u(0,1,0))]!=0u; }
  let parent=plant.parent-1u;
  if(parent>=settings.world.w) { return false; }
  let source=plants[parent];
  return source.energy>0.0 && source.birth==plant.parentBirth && source.colony==plant.colony;
}
@compute @workgroup_size(64)
fn metabolize(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x; if(i>=settings.world.w) { return; }
  let plant=plants[i]; energies[i]=-1.0;
  if(plant.energy<=0.0 || !attached(i)) { return; }
  let lifetime=65.0+random(plant.colony*31u+plant.birth*17u)*80.0;
  if(plant.age+settings.clock.x>=lifetime) { return; }
  let p=vec3i(coordinate(i));
  var exchange=0.0;
  for(var k=0u;k<6u;k++) {
    let q=p+neighbor(k); if(!inside(q)) { continue; }
    let other=plants[address(vec3u(q))];
    if(other.energy>0.0) { exchange+=(other.energy-plant.energy)*transportRate; }
  }
  // Opposite ends evaluate equal and opposite flux from the same old snapshot.
  // 6*transportRate*dt <= 1 keeps the diffusion update non-negative.
  let gain=select(0.0,2.4,sunlight[i]!=0u);
  let maintenance=0.16+0.0015*f32(p.y);
  energies[i]=clamp(plant.energy+settings.clock.x*(exchange+gain-maintenance),0.0,maximumEnergy);
}
fn proposal(i: u32) -> u32 {
  if(plants[i].energy<=0.0 || energies[i]<maximumEnergy) { return settings.world.w; }
  let p=vec3i(coordinate(i));
  let seed=i*131u+u32(settings.clock.y)*977u+settings.display.y;
  let first=u32(random(seed)*7.0);
  // Up has three tickets; each horizontal direction has one.
  for(var n=0u;n<7u;n++) {
    let ticket=(first+n)%7u;
    var direction=0u;
    if(ticket>=3u) { direction=ticket-2u; }
    let q=p+neighbor(direction); if(!inside(q)) { continue; }
    let destination=address(vec3u(q));
    if(terrain[destination]==0u && plants[destination].energy<=0.0) { return destination; }
  }
  return settings.world.w;
}
fn winner(destination: u32) -> u32 {
  let p=vec3i(coordinate(destination));
  var best=settings.world.w; var priority=2.0;
  for(var k=0u;k<5u;k++) {
    let q=p-neighbor(k); if(!inside(q)) { continue; }
    let candidate=address(vec3u(q));
    if(proposal(candidate)!=destination) { continue; }
    let rank=random(candidate*67u+destination*13u+u32(settings.clock.y));
    if(rank<priority || (rank==priority && candidate<best)) { best=candidate; priority=rank; }
  }
  return best;
}
@compute @workgroup_size(64)
fn grow(@builtin(global_invocation_id) id: vec3u) {
  let i=id.x; if(i>=settings.world.w) { return; }
  var next=emptyPlant();
  if(terrain[i]!=0u) { nextPlants[i]=next; return; }
  let plant=plants[i];
  if(plant.energy>0.0) {
    let energy=energies[i];
    if(energy>0.0) {
      next=plant; next.energy=energy; next.age+=settings.clock.x;
      let destination=proposal(i);
      if(destination<settings.world.w && winner(destination)==i) { next.energy-=birthCost; }
    }
  } else {
    let parent=winner(i);
    if(parent<settings.world.w) {
      let source=plants[parent];
      next=Plant(childEnergy,0.0,parent+1u,u32(settings.clock.y)+2u,source.birth,source.colony);
    } else {
      let p=coordinate(i);
      if(p.y>0u && terrain[address(p-vec3u(0,1,0))]!=0u && sunlight[i]!=0u &&
          random(i*17u+u32(settings.clock.y)*991u+settings.display.y)<0.00002*settings.clock.x) {
        next=Plant(3.0,0.0,0u,u32(settings.clock.y)+2u,0u,i+1u);
      }
    }
  }
  nextPlants[i]=next;
}
