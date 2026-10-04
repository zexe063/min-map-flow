import type { Chapter } from '../types';
import { parseOutline } from './outline';

/** A small, editable example. Import an outline to use your own subject. */
export const DEMO_OUTLINE = String.raw`# Motion in a straight line

## Describing motion

### Position & displacement
- Choose a reference frame
- Position $x(t)$
- Distance travelled
- Displacement
$$\Delta x = x_f - x_i$$
- Read a position–time graph

### Speed & velocity
- Average speed
$$\bar{s} = \frac{\text{distance}}{\Delta t}$$
- Average velocity
$$\bar{v} = \frac{\Delta x}{\Delta t}$$
- Instantaneous velocity
$$v = \frac{dx}{dt}$$
- Speed is $|v|$

## Predicting motion

### Acceleration
- Change in velocity
- Average acceleration
$$\bar{a} = \frac{\Delta v}{\Delta t}$$
- Instantaneous acceleration
$$a = \frac{dv}{dt}$$
- Read a velocity–time graph

### Equations of motion
- First, check: constant $a$
- Velocity after time $t$
$$v = u + at$$
- Displacement after time $t$
$$\Delta x = ut + \frac{1}{2}at^2$$
- Eliminate time
$$v^2 = u^2 + 2a\Delta x$$
- Free fall: choose your signs`;

const NOTES: Record<string, string> = {
  'Motion in a straight line': String.raw`An example chapter about one-dimensional motion.

Start by describing where an object is, then connect position, velocity, and acceleration. The equations in the final branch apply when acceleration is constant.

Study tip: choose an origin and a positive direction before substituting numbers. You can edit these notes, move any card, or replace this sample with your own outline.`,
  'Describing motion': 'Motion is a change of position relative to a reference frame. This section distinguishes distance from displacement and speed from velocity. Pay attention to which quantities depend on direction.',
  'Position & displacement': 'Position tells us where an object is at one instant. Displacement compares its final and initial positions. Distance adds up the length of the entire path, including any backtracking.',
  'Choose a reference frame': 'Choose an origin, a positive direction, and a clock. For a car on a straight road, you might set the start point to x = 0 and east as positive. Keep that choice throughout the problem; a negative position simply means the object is on the other side of the origin.',
  'Position $x(t)$': String.raw`The coordinate x(t) gives position at time t. Position is measured in metres (m), and time in seconds (s).

Example: x(t) = 3 + 2t means the object starts at x = 3 m and moves 2 m in the positive direction each second.`,
  'Distance travelled': 'Distance is the total path length and is always nonnegative. Walk 3 m east and then 2 m west: the distance travelled is 5 m. It does not matter which direction you chose as positive.',
  'Displacement': String.raw`Displacement is final position minus initial position: $\Delta x = x_f - x_i$.

Walk 3 m east and then 2 m west: the displacement is +1 m if east is positive. A round trip has zero displacement even though its distance is not zero.`,
  'Read a position–time graph': 'The slope of an x–t graph is velocity. A positive slope means motion in the positive direction; a horizontal line means rest. A steeper line means greater speed. The slope of a tangent gives instantaneous velocity, while a secant gives average velocity.',
  'Speed & velocity': 'Speed describes how fast an object moves. Velocity also describes its direction through a sign in one dimension. Average quantities describe a time interval; instantaneous quantities describe one moment.',
  'Average speed': String.raw`Divide total distance by elapsed time.

Example: a 100 m out-and-back trip completed in 20 s has an average speed of 5 m/s. Average speed is not generally the arithmetic mean of the speeds on individual legs.`,
  'Average velocity': 'Divide displacement by elapsed time. A return to the starting point gives zero average velocity, even when the object was moving throughout the trip. On an x–t graph, this is the slope of the line joining the initial and final points.',
  'Instantaneous velocity': String.raw`Instantaneous velocity is the derivative of position with respect to time.

If $x(t) = 2t^2 + 3$, then $v(t) = 4t$. At t = 2 s, the velocity is +8 m/s. Geometrically, find the tangent slope on the position–time graph.`,
  'Speed is $|v|$': 'Instantaneous speed is the magnitude of instantaneous velocity. A velocity of −6 m/s means a speed of 6 m/s in the negative direction. A speedometer shows speed, so it cannot tell you the direction of travel.',
  'Predicting motion': 'Acceleration links changes in velocity to time. Use graphs for general motion and the constant-acceleration equations when their assumption is satisfied. Always check units and the signs of your final answers.',
  'Acceleration': 'Acceleration describes the rate at which velocity changes. Its SI unit is m/s². A positive acceleration does not always mean speeding up: speed increases when velocity and acceleration have the same sign.',
  'Change in velocity': String.raw`Use $\Delta v = v_f - v_i$ with signed velocities.

Changing from +5 m/s to −5 m/s gives Δv = −10 m/s, although the initial and final speeds are equal. The direction change matters.`,
  'Average acceleration': 'Divide the change in velocity by elapsed time. A car speeding up from 4 m/s to 16 m/s over 3 s has an average acceleration of +4 m/s². This average alone does not tell you whether acceleration was constant during the interval.',
  'Instantaneous acceleration': String.raw`Acceleration is the derivative of velocity with respect to time and the second derivative of position.

If $v(t) = 3t^2$, then $a(t) = 6t$. The slope of the tangent to a v–t graph gives instantaneous acceleration.`,
  'Read a velocity–time graph': 'The slope gives acceleration. The signed area between the graph and the time axis gives displacement; area below the axis is negative. Add the magnitudes of those areas to find total distance. A horizontal v–t graph means constant velocity.',
  'Equations of motion': 'Use u for initial velocity, v for final velocity, a for constant acceleration, t for elapsed time, and Δx for displacement. List the known quantities, identify the unknown, and select an equation that avoids unnecessary unknowns.',
  'First, check: constant $a$': 'The equations in this branch assume constant acceleration over the whole interval. Do not apply them directly when acceleration varies with time or position. Split a journey into intervals if acceleration is constant only within each interval.',
  'Velocity after time $t$': 'Use v = u + at when displacement is not needed. Example: starting from rest with a = 2 m/s² for 3 s gives v = 6 m/s. Check the sign: a negative acceleration can reverse the direction if the interval is long enough.',
  'Displacement after time $t$': String.raw`Use $\Delta x = ut + \frac{1}{2}at^2$ when final velocity is not needed.

Example: an object starts at 4 m/s and accelerates at 2 m/s² for 3 s. Its displacement is 4 × 3 + ½ × 2 × 3² = 21 m. Add the initial position if the question asks for final position.`,
  'Eliminate time': String.raw`Use $v^2 = u^2 + 2a\Delta x$ when time is unknown or unnecessary.

Example: a car at 10 m/s brakes at −2 m/s². Setting v = 0 gives a stopping displacement of 25 m. Squaring removes velocity's sign, so choose the physically relevant sign when taking a square root.`,
  'Free fall: choose your signs': 'Near Earth, ideal free fall has acceleration of magnitude g ≈ 9.8 m/s² downward. If upward is positive, a = −g on both the way up and the way down. At the highest point, velocity is momentarily zero but acceleration is still −g. Ignore air resistance for this model.',
};

export function createDemoChapter(): Chapter {
  const parsed = parseOutline(DEMO_OUTLINE);
  return {
    id: 'chapter-motion-example',
    title: parsed.title,
    outline: DEMO_OUTLINE,
    nodes: parsed.nodes.map((node) => ({
      ...node,
      data: { ...node.data, notes: NOTES[node.data.label.split('\n')[0]] ?? '' },
    })),
    edges: parsed.edges,
    updatedAt: Date.now(),
  };
}
