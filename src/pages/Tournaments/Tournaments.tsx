import type * as React from "react";

import {useForm, useFieldArray} from "react-hook-form";
import {z} from "zod";
import {zodResolver} from "@hookform/resolvers/zod";
import {type Competition, CompetitionSchema} from "../../schema";
import {addCompetition} from "../../services/firebase/firestoreService";

const Tournaments: React.FC = () => {
    return <div>tournaments</div>;
};

export default Tournaments;
