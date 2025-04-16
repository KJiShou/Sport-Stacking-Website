import {useEffect, useState} from "react";
import {addAthlete, getAthletes} from "../../api/firestoreService";
// import { CompetitionSchema } from "../../schema";
const Athletes = () => {
    const [athletes, setAthletes] = useState([]);

    useEffect(() => {
        fetchAthletes();
    }, []);

    const fetchAthletes = async () => {
        const data = await getAthletes();
        setAthletes(data);
    };

    const handleAddAthlete = async () => {
        await addAthlete({
            name: "John Doe",
            country: "USA",
            age: 25,
        });
        fetchAthletes(); // Refresh list after adding
    };

    return (
        <div>
            <h1>🏆 Athletes</h1>
            <button onClick={handleAddAthlete}>Add Athlete</button>
            <ul>
                {athletes.map((athlete) => (
                    <li key={athlete.id}>
                        {athlete.name} - {athlete.country} (Age: {athlete.age})
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default Athletes;
