extern crate self as cap_project;
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct XY<T> { pub x:T, pub y:T }
impl<T> XY<T> { pub fn new(x:T,y:T)->Self { Self{x,y} } }
#[path="/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/next/cap/crates/rendering/src/spring_mass_damper.rs"]
mod spring_mass_damper;
use spring_mass_damper::{SpringMassDamperSimulation as Sim, SpringMassDamperSimulationConfig as C};
fn main() {
 let default=C{tension:80.,mass:2.5,friction:28.}; let snappy=C{tension:530.,mass:1.,friction:40.}; let drag=C{tension:1000.,mass:1.,friction:40.};
 let mut sim=Sim::new(default); sim.set_position(XY::new(0.,0.)); sim.set_velocity(XY::new(0.,0.)); sim.set_target_position(XY::new(0.,0.)); sim.set_config(snappy);
 println!("ms raw_x target_x output_x velocity profile");
 println!("0 0.000000 0.000000 0.000000 0.000000 snappy");
 for i in 1..=36 { let t=i as f64*1000./60.; sim.run((1000./60.) as f32); let raw=((t-100.)/400.).clamp(0.,1.) as f32; let next=if t<100. {Some((100.,0.))} else if t<500. {Some((500.,1.))} else {None}; let target=next.filter(|(ct,_)| ct-t<=500.).map_or(raw,|(_,x)|x); let (profile,cfg)=if next.is_some_and(|(ct,_)|ct-t<=175.) {("snappy",snappy)} else if (100. ..500.).contains(&t) {("drag",drag)} else {("default",default)}; sim.set_target_position(XY::new(target,0.)); sim.set_config(cfg); if [5,6,7,12,18,19,20,29,30,31,36].contains(&i) {println!("{t:.3} {raw:.6} {target:.6} {:.6} {:.6} {profile}",sim.position.x,sim.velocity.x);} }
}
