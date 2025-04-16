import * as React from 'react';
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Competition, CompetitionSchema } from '../../schema';
import { addCompetition } from "../../services/firebase/firestoreService";

export default function AddCompetition() {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    reset,
  } = useForm<Competition>({
    resolver: zodResolver(CompetitionSchema),
    defaultValues: {
      age_brackets: [],
      events: [],
      final_criteria: [],
      finalCategory: [],
    },
  });

  // Dynamic field arrays
  const ageBrackets = useFieldArray({ control, name: "age_brackets" });
  const events = useFieldArray({ control, name: "events" });
  const finalCriteria = useFieldArray({ control, name: "final_criteria" });
  const finalCategory = useFieldArray({ control, name: "finalCategory" });

  const onSubmit = async (data: Competition) => {
    try {
      const payload = {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
      };
      await addCompetition(payload as any);
      alert("Competition added!");
      reset();
    } catch (err) {
      console.error(err);
      alert("Error adding competition");
    }
  };
  console.log("❌ Zod errors:", errors);
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-2xl">
      <h2 className="text-xl font-bold">Add Competition</h2>

      <input {...register("name")} placeholder="Name" className="input" />
      {errors.name && <p>{errors.name.message}</p>}

      <input type="date" {...register("startDate")} className="input" />
      <input type="date" {...register("endDate")} className="input" />

      <input {...register("location")} placeholder="Location" className="input" />

      <select {...register("status")} className="input">
        <option value="">Select status</option>
        <option value="upcoming">Upcoming</option>
        <option value="ongoing">Ongoing</option>
        <option value="completed">Completed</option>
      </select>

      <input type="number" {...register("maxNumber")} placeholder="Max Number" className="input" />

      <div>
        <h3 className="font-semibold">Age Brackets</h3>
        {ageBrackets.fields.map((field, idx) => (
          <div key={field.id} className="border p-2 my-2">
            <input {...register(`age_brackets.${idx}.name`)} placeholder="Name" className="input" />
            <input type="number" {...register(`age_brackets.${idx}.minAge`)} placeholder="Min Age" className="input" />
            <input type="number" {...register(`age_brackets.${idx}.maxAge`)} placeholder="Max Age" className="input" />
            <select {...register(`age_brackets.${idx}.code`)} className="input">
              <option value="individual">Individual</option>
              <option value="relay">Relay</option>
            </select>
            <select {...register(`age_brackets.${idx}.type`)} className="input">
              <option value="individual">Individual</option>
              <option value="team">Team</option>
            </select>
            <input type="number" {...register(`age_brackets.${idx}.maxNumber`)} placeholder="Max" className="input" />
          </div>
        ))}
        <button type="button" onClick={() => ageBrackets.append({ name: "", minAge: 0, maxAge: 0, code: "individual", type: "individual" })}>
          Add Age Bracket
        </button>
      </div>

      <div>
        <h3 className="font-semibold">Events</h3>
        {events.fields.map((field, idx) => (
          <div key={field.id} className="border p-2 my-2">
            <select {...register(`events.${idx}.code`)} className="input">
              <option value="individual">Individual</option>
              <option value="relay">Relay</option>
            </select>
            <select {...register(`events.${idx}.type`)} className="input">
              <option value="individual">Individual</option>
              <option value="team">Team</option>
            </select>
            <input type="number" {...register(`events.${idx}.teamSize`)} placeholder="Team Size" className="input" />
          </div>
        ))}
        <button type="button" onClick={() => events.append({ code: "individual", type: "individual" })}>
          Add Event
        </button>
      </div>

      <div>
        <h3 className="font-semibold">Final Criteria</h3>
        {finalCriteria.fields.map((field, idx) => (
          <div key={field.id}>
            <select {...register(`final_criteria.${idx}.type`)} className="input">
              <option value="individual">Individual</option>
              <option value="relay">Relay</option>
            </select>
          </div>
        ))}
        <button type="button" onClick={() => finalCriteria.append({ type: "individual" })}>
          Add Final Criteria
        </button>
      </div>

      <div>
        <h3 className="font-semibold">Final Category</h3>
        {finalCategory.fields.map((field, idx) => (
          <div key={field.id}>
            <input {...register(`finalCategory.${idx}.name`)} placeholder="Category Name" className="input" />
            <input type="number" {...register(`finalCategory.${idx}.start`)} placeholder="Start" className="input" />
            <input type="number" {...register(`finalCategory.${idx}.end`)} placeholder="End" className="input" />
          </div>
        ))}
        <button type="button" onClick={() => finalCategory.append({ name: "", start: 0, end: 0 })}>
          Add Final Category
        </button>
      </div>

      <button type="submit" className="bg-green-500 text-white px-4 py-2 rounded">
        Submit
      </button>
    </form>
  );
}
